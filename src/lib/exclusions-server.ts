import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { sendEmail } from './email';
import { audit } from './audit';
import { assignmentWhere } from './schedule-server';
import { AUTO_TYPE, LEIE_URL, OIG_SEARCH_URL, RESCREEN_DAYS, VALID_DAYS, indexLeie, listDate, matchWorker, parseLeie, type LeieIndex } from './exclusions';

const INACTIVE = ['Inactive', 'Do not use'];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

/** Downloads and indexes the current OIG list. `asOf` is the file's own date, for the record. */
export async function loadLeie(fetcher: typeof fetch = fetch) {
  let res: Response;
  try { res = await fetcher(process.env.OIG_LEIE_URL || LEIE_URL, { signal: AbortSignal.timeout(120_000) }); }
  catch { throw new HttpError(502, 'Couldn’t download the OIG exclusion list. Try again in a few minutes.'); }
  if (!res.ok) throw new HttpError(502, 'Couldn’t download the OIG exclusion list. Try again in a few minutes.');
  const list = parseLeie(await res.text());
  if (list.length < 1) throw new HttpError(502, 'The OIG exclusion list came back empty. Nothing was changed; try again later.');
  const modified = res.headers.get('last-modified');
  return { index: indexLeie(list), size: list.length, asOf: modified && !Number.isNaN(Date.parse(modified)) ? ymd(new Date(modified)) : ymd(new Date()) };
}

/** People who should be screened: on assignment now, or a current employee. */
async function workers(tdb: TenantDb) {
  return tdb.candidate.findMany({
    where: { status: { notIn: INACTIVE }, OR: [{ applications: { some: assignmentWhere } }, { employee: { is: { status: { not: 'TERMINATED' } } } }] },
    select: { id: true, name: true, credentials: { where: { type: { in: ['NPI', AUTO_TYPE] } }, select: { id: true, type: true, number: true, expiresAt: true } }, _count: { select: { exclusionMatches: true } } },
  });
}

/** Records a clean screening as a verified credential, renewing the one on file. */
async function renew(tdb: TenantDb, candidateId: string, asOf: string, today: string) {
  const data = {
    issuedAt: day(today), expiresAt: new Date(day(today).getTime() + VALID_DAYS * 864e5), verifiedAt: new Date(), verifiedById: null,
    verifyMethod: 'Automatic monthly screening', verifyNote: `Not on the OIG List of Excluded Individuals/Entities (list updated ${asOf}).`, alertedLevel: null,
  };
  const had = await tdb.credential.findFirst({ where: { candidateId, type: AUTO_TYPE }, orderBy: { createdAt: 'desc' } });
  if (had) await tdb.credential.updateMany({ where: { id: had.id }, data });
  else await tdb.credential.create({ data: { candidateId, type: AUTO_TYPE, ...data } as never });
}

/**
 * Screens one company's workers. New possible matches are saved for review (a match someone already cleared isn't
 * raised again); everyone with nothing open is renewed as screened. Admins get one email about new matches.
 */
export async function screenOrg(org: Pick<Organization, 'id' | 'name'>, leie: { index: LeieIndex; asOf: string }, now = new Date()) {
  const tdb = tenantDb(org.id), today = ymd(now);
  const people = await workers(tdb);
  const fresh: { name: string; listed: string }[] = [];
  for (const p of people) {
    const npis = p.credentials.filter((c) => c.type === 'NPI' && c.number).map((c) => c.number!.replace(/\D/g, ''));
    for (const h of matchWorker({ name: p.name, npis }, leie.index)) {
      if (await tdb.exclusionMatch.findFirst({ where: { candidateId: p.id, listKey: h.listed.key }, select: { id: true } })) continue;
      const l = h.listed;
      await tdb.exclusionMatch.create({ data: {
        candidateId: p.id, listKey: l.key, listedName: l.name, listedNpi: l.npi, listedDob: l.dob, listedPlace: l.place, specialty: l.specialty,
        exclType: l.exclType, exclDate: l.exclDate, matchedOn: h.on,
      } as never });
      fresh.push({ name: p.name, listed: `${l.name}${l.place ? `, ${l.place}` : ''}${h.on === 'npi' ? ' (same NPI)' : ''}` });
    }
  }
  const open = new Set((await tdb.exclusionMatch.findMany({ where: { status: { in: ['OPEN', 'CONFIRMED'] } }, select: { candidateId: true } })).map((m) => m.candidateId));
  let screened = 0;
  for (const p of people) if (!open.has(p.id)) { await renew(tdb, p.id, leie.asOf, today); screened++; }
  await db.organization.update({ where: { id: org.id }, data: { exclusionScreenedAt: now, exclusionListDate: leie.asOf } });
  await logActivity(org.id, `Exclusion screening: ${people.length} worker${people.length === 1 ? '' : 's'} checked against the OIG list${fresh.length ? `, ${fresh.length} possible match${fresh.length === 1 ? '' : 'es'} to review` : ', no matches'}`);
  if (fresh.length) await notify(org, fresh);
  return { workers: people.length, cleared: screened, newMatches: fresh.length, held: people.length - screened };
}

async function notify(org: Pick<Organization, 'id' | 'name'>, fresh: { name: string; listed: string }[]) {
  const admins = await db.membership.findMany({ where: { organizationId: org.id, role: { in: ['OWNER', 'ADMIN'] } }, select: { user: { select: { email: true } } } });
  const subject = `${fresh.length} possible OIG exclusion match${fresh.length === 1 ? '' : 'es'} to review`;
  const text = [
    `The monthly exclusion screening for ${org.name} found ${fresh.length === 1 ? 'a name' : 'names'} on the OIG List of Excluded Individuals/Entities that could be your workers:`, '',
    ...fresh.map((f) => `• ${f.name} — listed: ${f.listed}`), '',
    'A matching name isn’t proof. Confirm each one on OIG’s online search, which checks the Social Security number, before you act:',
    OIG_SEARCH_URL, '', `Then mark it cleared or confirmed: ${appUrl()}/app/credentials/exclusions`, '',
    'Until you do, their screening isn’t renewed.',
  ].join('\n');
  const tdb = tenantDb(org.id);
  for (const a of admins) {
    let status = 'sent', providerId: string | null = null, error: string | null = null;
    try { providerId = (await sendEmail({ to: a.user.email, subject, text, fromName: org.name })).id; }
    catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 500); }
    await tdb.message.create({ data: { channel: 'email', toAddress: a.user.email, subject, body: text, relatedType: 'exclusion_screening', status, providerId, error } as never });
  }
}

/** Companies due a screening: never screened, a month since the last, or someone new who's never been checked. */
async function due(now: Date) {
  const orgs = await db.organization.findMany({ where: { exclusionScreening: true, subscriptionStatus: { in: ['trialing', 'active'] } } });
  const out: Organization[] = [];
  for (const o of orgs.filter((x) => hasFeature(x, 'credentials'))) {
    if (!o.exclusionScreenedAt || now.getTime() - o.exclusionScreenedAt.getTime() >= RESCREEN_DAYS * 864e5) { out.push(o); continue; }
    // Someone held back by a match under review has been checked; they wait for the review, not a new download.
    const unscreened = (await workers(tenantDb(o.id))).some((p) => !p.credentials.some((c) => c.type === AUTO_TYPE) && !p._count.exclusionMatches);
    if (unscreened) out.push(o);
  }
  return out;
}

/** Daily job: downloads the list once (only when someone is due) and screens each company that's due. */
export async function runExclusionScreening(now = new Date(), fetcher: typeof fetch = fetch) {
  const orgs = await due(now);
  if (!orgs.length) return { companies: 0 };
  const leie = await loadLeie(fetcher);
  let matches = 0, workersN = 0;
  for (const o of orgs) { const r = await screenOrg(o, leie, now); matches += r.newMatches; workersN += r.workers; }
  return { companies: orgs.length, workers: workersN, newMatches: matches, listSize: leie.size, asOf: leie.asOf };
}

export const SettingsBody = z.object({ enabled: z.boolean() });
export async function setScreening(org: Organization, user: User, enabled: boolean) {
  await db.organization.update({ where: { id: org.id }, data: { exclusionScreening: enabled } });
  await audit(org.id, user, 'exclusion.settings', `${enabled ? 'Turned on' : 'Turned off'} monthly OIG exclusion screening`, { changes: { exclusionScreening: [org.exclusionScreening, enabled] } });
}

export const ReviewBody = z.object({
  decision: z.enum(['CLEARED', 'CONFIRMED'], { errorMap: () => ({ message: 'Choose cleared or confirmed.' }) }),
  note: z.string().trim().min(5, 'Say how you checked (for example, “OIG search: SSN doesn’t match”).').max(500, 'Keep the note under 500 characters.'),
});

/**
 * Cleared: a different person; their screening is renewed if nothing else is open. Confirmed: they're excluded, so
 * they go on the company-wide do-not-return list (which stops placing and scheduling them) and the screening lapses.
 */
export async function reviewMatch(org: Organization, user: User, id: string, body: z.infer<typeof ReviewBody>) {
  const tdb = tenantDb(org.id);
  const m = await tdb.exclusionMatch.findFirst({ where: { id }, include: { candidate: { select: { id: true, name: true } } } });
  if (!m) throw new HttpError(404, 'That match was deleted.');
  if (m.status !== 'OPEN') throw new HttpError(409, `That match was already ${m.status === 'CLEARED' ? 'cleared' : 'confirmed'}.`);
  await tdb.exclusionMatch.updateMany({ where: { id: m.id, status: 'OPEN' }, data: { status: body.decision, reviewedById: user.id, reviewedAt: new Date(), reviewNote: body.note } });
  const listed = `${m.listedName}${m.listedPlace ? `, ${m.listedPlace}` : ''}`;
  if (body.decision === 'CONFIRMED') {
    if (!(await tdb.doNotReturn.findFirst({ where: { candidateId: m.candidateId, clientId: null, liftedAt: null } })))
      await tdb.doNotReturn.create({ data: { candidateId: m.candidateId, clientId: null, source: 'exclusion screening', reason: `On the OIG exclusion list (${m.exclType ?? 'excluded'} since ${listDate(m.exclDate) ?? 'unknown date'}). Confirmed by ${user.name || user.email}: ${body.note}`, createdById: user.id } as never });
    await tdb.credential.updateMany({ where: { candidateId: m.candidateId, type: AUTO_TYPE }, data: { verifiedAt: null, verifyNote: `Confirmed on the OIG exclusion list: ${body.note}` } });
  } else if (!(await tdb.exclusionMatch.count({ where: { candidateId: m.candidateId, status: { in: ['OPEN', 'CONFIRMED'] } } }))) {
    const o = await db.organization.findUnique({ where: { id: org.id }, select: { exclusionListDate: true } });
    await renew(tdb, m.candidateId, o?.exclusionListDate ?? ymd(new Date()), ymd(new Date()));
  }
  const text = `${body.decision === 'CONFIRMED' ? 'Confirmed' : 'Cleared'} possible OIG exclusion match for ${m.candidate.name} (listed: ${listed}): ${body.note}`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'exclusion.review', text, { targetType: 'candidate', targetId: m.candidateId });
}
