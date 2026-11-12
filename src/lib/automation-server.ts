import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb } from './tenant';
import { hasFeature } from './plans';
import { audit, diff } from './audit';
import { scoreApplications } from './match-server';
import { proposeInterview } from './interviews-server';
import { inviteOnboarding, startOnboarding } from './onboarding-server';
import { STAGE_ORDER } from './eeo';
import { AutomationBody, automationOf, pickSlots } from './automation';

const later = (stage: string, than: string) => STAGE_ORDER.indexOf(stage as never) > STAGE_ORDER.indexOf(than as never);

/** Saves the company's automations. The interviewer must be on the team and the package must exist. */
export async function saveAutomation(org: Organization, user: User, body: unknown) {
  const r = AutomationBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the automation settings.');
  const b = r.data, tdb = tenantDb(org.id);
  if (b.interviews.interviewerId && !(await db.membership.findFirst({ where: { organizationId: org.id, userId: b.interviews.interviewerId, role: { not: 'VIEWER' } } })))
    throw new HttpError(400, 'The interviewer has to be on your team.');
  if (b.onboarding.packageId && !(await tdb.onboardingPackage.findFirst({ where: { id: b.onboarding.packageId, archived: false } })))
    throw new HttpError(400, 'That onboarding package was archived or deleted.');
  await db.organization.update({ where: { id: org.id }, data: { automation: b } });
  const changes = diff(automationOf(org.automation) as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
  await audit(org.id, user, 'settings.automation', `Changed hiring automations: ${Object.keys(changes).join(', ') || 'no changes'}`, { changes });
}

/** Who automated steps act as: the person who triggered them, else the company owner. */
async function actor(orgId: string, userId?: string | null) {
  const m = await db.membership.findFirst({ where: { organizationId: orgId, ...(userId ? { userId } : { role: 'OWNER' }) }, include: { user: true }, orderBy: { createdAt: 'asc' } });
  return m?.user ?? null;
}

/** An automation that can't finish is noted in the activity feed for a person to pick up; it never stops the step that triggered it. */
async function safely(orgId: string, what: string, fn: () => Promise<unknown>) {
  try { return await fn(); } catch (e) {
    await logActivity(orgId, `Automation couldn’t ${what}: ${e instanceof HttpError ? e.message : 'something went wrong'}. Do it by hand from the candidate’s record.`);
    if (!(e instanceof HttpError)) console.error('[automation]', what, e);
    return null;
  }
}

/**
 * A new application: with screening on, a strong match (by skills, certifications, experience, location and pay)
 * moves to Screened, which can offer interview times. Nobody is rejected automatically; everyone else waits for a person.
 */
export async function onApplied(org: Organization, applicationId: string) {
  const a = automationOf(org.automation);
  if (!a.screen.on || !hasFeature(org, 'ats')) return null;
  const tdb = tenantDb(org.id);
  const app = await tdb.application.findFirst({ where: { id: applicationId }, include: { candidate: { select: { name: true } }, job: { select: { title: true } } } });
  if (!app || app.stage !== 'APPLIED') return null;
  const score = (await scoreApplications(tdb, [app])).get(app.id) ?? 0;
  if (score < a.screen.advanceAt) return { score, screened: false };
  await tdb.application.updateMany({ where: { id: app.id, stage: 'APPLIED' }, data: { stage: 'SCREENED', maxStage: later(app.maxStage, 'SCREENED') ? app.maxStage : 'SCREENED', stageChangedAt: new Date() } });
  await logActivity(org.id, `${app.candidate.name} was screened automatically for ${app.job.title} (match ${score} of 100)`);
  await onScreened(org, app.id);
  return { score, screened: true };
}

/** Screened: with interview scheduling on, the candidate gets times to pick from the interviewer's free hours. */
export async function onScreened(org: Organization, applicationId: string) {
  const a = automationOf(org.automation), cfg = a.interviews;
  if (!cfg.on || !cfg.interviewerId) return null;
  const tdb = tenantDb(org.id);
  if (await tdb.interview.findFirst({ where: { applicationId, status: { in: ['PROPOSED', 'SCHEDULED'] } } })) return null;
  const user = await actor(org.id, cfg.interviewerId);
  if (!user) return null;
  return safely(org.id, 'offer interview times', async () => {
    const now = new Date();
    const busy = (await tdb.interview.findMany({ where: { status: 'SCHEDULED', interviewerIds: { has: user.id }, startsAt: { gte: now, lte: new Date(now.getTime() + 30 * 864e5) } } }))
      .map((i) => ({ start: i.startsAt!, minutes: i.durationMin }));
    const slots = pickSlots(now, org.timezone, cfg, busy);
    if (slots.length < 2) throw new HttpError(409, 'the interviewer has no free times in the next three weeks');
    return proposeInterview({ tdb, org, user, role: 'RECRUITER' }, {
      applicationId, kind: cfg.kind, durationMin: cfg.durationMin, location: cfg.location, interviewerIds: [user.id], slots, channels: a.channels,
    });
  });
}

/** Offer (or straight to placed): with onboarding on, the new-hire paperwork starts and the link goes out. */
export async function onOffer(org: Organization, applicationId: string, byUserId?: string | null) {
  const a = automationOf(org.automation);
  if (!a.onboarding.on || !a.onboarding.packageId || !hasFeature(org, 'onboarding')) return null;
  const tdb = tenantDb(org.id);
  if (await tdb.onboarding.findFirst({ where: { applicationId, status: { not: 'CANCELLED' } } })) return null;
  const user = await actor(org.id, byUserId);
  if (!user) return null;
  return safely(org.id, 'start onboarding', async () => {
    const ob = await startOnboarding(org, user, { applicationId, packageId: a.onboarding.packageId! });
    return inviteOnboarding(org, user, ob.id, a.channels);
  });
}
