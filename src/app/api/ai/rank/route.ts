import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { aiJson } from '@/lib/ai';

export const POST = withApi(async (req: Request) => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ai' });
  const { jobId } = z.object({ jobId: z.string() }).parse(await req.json());
  const job = await tdb.job.findFirst({ where: { id: jobId }, include: { applications: { select: { candidateId: true } } } });
  if (!job) throw new HttpError(404, 'Job not found');
  const exclude = job.applications.map((a) => a.candidateId);
  const pool = await tdb.candidate.findMany({ where: { id: { notIn: exclude }, status: { notIn: ['Inactive', 'Do not use'] } }, orderBy: { updatedAt: 'desc' }, take: 120,
    select: { id: true, title: true, sector: true, skills: true, certs: true, yearsExp: true, location: true, desiredRate: true, availability: true } });
  if (!pool.length) return Response.json({ matches: [] });
  // Names and contact details are deliberately not sent to the model.
  const res = await aiJson<{ id: string; score: number; reason: string }[]>(org,
    `You are a senior staffing recruiter. Rank the best candidates for this job by skills, certifications, sector, location, experience, rate fit (desired rate at or below pay rate) and availability. Do not consider or infer age, race, gender, religion, national origin, disability or any other protected characteristic.
JOB: ${JSON.stringify({ title: job.title, sector: job.sector, location: job.location, type: job.type, payRate: job.payRate, skills: job.skills, description: job.description?.slice(0, 1500) })}
CANDIDATES: ${JSON.stringify(pool)}
Return a JSON array of up to 8 objects {"id","score" (0-100),"reason" (under 20 words)}, best first, only scores of 40 or more.`);
  const ids = new Set(pool.map((p) => p.id));
  return Response.json({ matches: (Array.isArray(res) ? res : []).filter((m) => ids.has(m.id)) });
});
