import type { TenantDb } from './tenant';
import { HttpError } from './tenant';
import { scoreMatch, type Match, type MatchCandidate, type MatchJob } from './match';

/** Ranking candidates for a job (and jobs for a candidate), from what's in the database. */
const INACTIVE = ['Inactive', 'Do not use', 'Former employee'];
const candSelect = { id: true, name: true, title: true, skills: true, certs: true, summary: true, sector: true, location: true, yearsExp: true, desiredRate: true, availability: true, status: true } as const;
type CandRow = { id: string; name: string; title: string | null; skills: string[]; certs: string[]; summary: string | null; sector: string | null; location: string | null; yearsExp: number | null; desiredRate: unknown; availability: string | null; status: string };

const toJob = (j: { title: string; skills: string[]; requiredCerts: string[]; sector: string | null; location: string | null; remote: boolean; payRate: unknown; description: string | null; posting?: string | null }): MatchJob =>
  ({ title: j.title, skills: j.skills, requiredCerts: j.requiredCerts, sector: j.sector, location: j.location, remote: j.remote, payRate: j.payRate == null ? null : Number(j.payRate), description: j.posting ?? j.description });

/** Current (unexpired) credential types per candidate. */
async function credentialsFor(tdb: TenantDb, ids: string[]) {
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const rows = ids.length ? await tdb.credential.findMany({ where: { candidateId: { in: ids }, OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] }, select: { candidateId: true, type: true } }) : [];
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.candidateId, [...(m.get(r.candidateId) ?? []), r.type]);
  return m;
}
const toCand = (c: CandRow, creds: Map<string, string[]>): MatchCandidate => ({
  title: c.title, skills: c.skills, certs: c.certs, summary: c.summary, sector: c.sector, location: c.location, yearsExp: c.yearsExp,
  desiredRate: c.desiredRate == null ? null : Number(c.desiredRate), availability: c.availability, credentials: creds.get(c.id) ?? [],
});

export type Ranked = { candidateId: string; name: string; title: string | null; location: string | null; status: string; applicationId: string | null; stage: string | null; source: string | null; flags: string[] } & Match;

/**
 * Everyone worth considering for a job, best first: people already in its pipeline, and (with `pool`) the rest of
 * the talent pool. People on a do-not-return list for the job's client (or company-wide) are left out of the pool
 * and flagged in the pipeline.
 */
export async function rankForJob(tdb: TenantDb, jobId: string, opts: { pool?: boolean; limit?: number } = {}) {
  const job = await tdb.job.findFirst({ where: { id: jobId } });
  if (!job) throw new HttpError(404, 'That job was deleted.');
  const apps = await tdb.application.findMany({ where: { jobId }, select: { id: true, stage: true, source: true, candidate: { select: candSelect } } });
  const pool = opts.pool ? await tdb.candidate.findMany({ where: { status: { notIn: INACTIVE }, applications: { none: { jobId } } }, select: candSelect, orderBy: { updatedAt: 'desc' }, take: 3000 }) : [];
  const all = [...apps.map((a) => a.candidate), ...pool];
  const [creds, dnr] = await Promise.all([
    credentialsFor(tdb, all.map((c) => c.id)),
    tdb.doNotReturn.findMany({ where: { liftedAt: null, candidateId: { in: all.map((c) => c.id) }, OR: [{ clientId: null }, ...(job.clientId ? [{ clientId: job.clientId }] : [])] }, select: { candidateId: true } }),
  ]);
  const barred = new Set(dnr.map((d) => d.candidateId));
  const mj = toJob(job);
  const rank = (c: CandRow, app: { id: string; stage: string; source: string | null } | null): Ranked => {
    const m = scoreMatch(mj, toCand(c, creds));
    const flags = [...(barred.has(c.id) ? ['Do not return'] : []), ...(c.status === 'On assignment' && app?.stage !== 'PLACED' ? ['On assignment'] : []), ...(m.certGaps.length ? ['Missing certification'] : [])];
    return { candidateId: c.id, name: c.name, title: c.title, location: c.location, status: c.status, applicationId: app?.id ?? null, stage: app?.stage ?? null, source: app?.source ?? null, flags, ...m };
  };
  const inPipeline = apps.map((a) => rank(a.candidate, a)).sort((a, b) => b.score - a.score);
  const prospects = pool.filter((c) => !barred.has(c.id)).map((c) => rank(c, null)).sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 15);
  return { job: { id: job.id, title: job.title, skills: job.skills, requiredCerts: job.requiredCerts, hasSkills: job.skills.length > 0 }, inPipeline, prospects };
}

/** Open jobs for a candidate, best first. */
export async function rankJobsFor(tdb: TenantDb, candidateId: string, limit = 8) {
  const c = await tdb.candidate.findFirst({ where: { id: candidateId }, select: candSelect });
  if (!c) throw new HttpError(404, 'That candidate was deleted.');
  const [jobs, creds, mine] = await Promise.all([
    tdb.job.findMany({ where: { status: 'OPEN' }, take: 500 }),
    credentialsFor(tdb, [c.id]),
    tdb.application.findMany({ where: { candidateId }, select: { jobId: true } }),
  ]);
  const taken = new Set(mine.map((a) => a.jobId));
  const cand = toCand(c, creds);
  return jobs.filter((j) => !taken.has(j.id)).map((j) => ({ jobId: j.id, title: j.title, location: j.location, ...scoreMatch(toJob(j), cand) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Scores for many applications at once (the pipeline board). */
export async function scoreApplications(tdb: TenantDb, apps: { id: string; jobId: string; candidateId: string }[]) {
  if (!apps.length) return new Map<string, number>();
  const [jobs, cands] = await Promise.all([
    tdb.job.findMany({ where: { id: { in: [...new Set(apps.map((a) => a.jobId))] } } }),
    tdb.candidate.findMany({ where: { id: { in: [...new Set(apps.map((a) => a.candidateId))] } }, select: candSelect }),
  ]);
  const creds = await credentialsFor(tdb, cands.map((c) => c.id));
  const out = new Map<string, number>();
  for (const a of apps) {
    const j = jobs.find((x) => x.id === a.jobId), c = cands.find((x) => x.id === a.candidateId);
    if (j && c) out.set(a.id, scoreMatch(toJob(j), toCand(c, creds)).score);
  }
  return out;
}
