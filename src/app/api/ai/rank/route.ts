import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { aiJson } from '@/lib/ai';

const Body = z.object({ jobId: z.string().min(1), candidateIds: z.array(z.string().min(1)).max(30).optional() });

/**
 * An AI second opinion on candidates for a job. With `candidateIds` it reviews that shortlist (pipeline or pool);
 * otherwise it looks through recent candidates who aren't in the job's pipeline yet.
 */
export const POST = withApi(async (req: Request) => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ai' });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, 'Choose a job to rank candidates for.');
  const { jobId, candidateIds } = r.data;
  const job = await tdb.job.findFirst({ where: { id: jobId }, include: { applications: { select: { candidateId: true } } } });
  if (!job) throw new HttpError(404, 'That job was deleted.');
  const exclude = job.applications.map((a) => a.candidateId);
  const pool = await tdb.candidate.findMany({
    where: candidateIds ? { id: { in: candidateIds }, status: { notIn: ['Inactive', 'Do not use'] } } : { id: { notIn: exclude }, status: { notIn: ['Inactive', 'Do not use'] } },
    orderBy: { updatedAt: 'desc' }, take: candidateIds ? 30 : 120,
    // Names, contact details, resumes and free-text summaries are deliberately not sent to the model.
    select: { id: true, title: true, sector: true, skills: true, certs: true, yearsExp: true, location: true, desiredRate: true, availability: true },
  });
  if (!pool.length) return Response.json({ matches: [] });
  const res = await aiJson<{ id: string; score: number; reason: string }[]>(org,
    `You are a senior staffing recruiter. Rank the best candidates for this job by skills, certifications, sector, location, experience, rate fit (desired rate at or below pay rate) and availability. Do not consider or infer age, race, gender, religion, national origin, disability or any other protected characteristic.
JOB: ${JSON.stringify({ title: job.title, sector: job.sector, location: job.location, remote: job.remote, type: job.type, payRate: job.payRate, skills: job.skills, requiredCerts: job.requiredCerts, description: job.description?.slice(0, 1500) })}
CANDIDATES: ${JSON.stringify(pool)}
Return a JSON array of up to ${candidateIds ? 20 : 8} objects {"id","score" (0-100),"reason" (under 20 words)}, best first, only scores of 40 or more.`);
  const ids = new Set(pool.map((p) => p.id));
  return Response.json({ matches: (Array.isArray(res) ? res : []).filter((m) => m && ids.has(m.id)).map((m) => ({ id: m.id, score: Math.max(0, Math.min(100, Math.round(Number(m.score) || 0))), reason: String(m.reason ?? '').slice(0, 200) })) });
});
