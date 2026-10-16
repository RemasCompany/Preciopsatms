import type { TenantDb } from './tenant';
import { extractResumeText } from './resume';
import { mergeList, readResume, type ResumeFacts } from './skills';

/** Work facts from a resume, read against this company's own job skills (the job applied to first). */
export async function factsFromText(tdb: TenantDb, text: string, jobId?: string): Promise<ResumeFacts> {
  const jobs = await tdb.job.findMany({ where: { status: { in: ['OPEN', 'ON_HOLD'] } }, select: { id: true, title: true, skills: true }, orderBy: { createdAt: 'desc' }, take: 300 });
  const first = jobs.find((j) => j.id === jobId);
  const vocab = [...(first?.skills ?? []), ...jobs.flatMap((j) => j.skills)];
  return readResume(text, { vocab, titles: [...(first ? [first.title] : []), ...jobs.map((j) => j.title)] });
}

/** Same, from an uploaded file. Unreadable files give nothing rather than an error: the resume is still kept. */
export async function factsFromFile(tdb: TenantDb, buf: Buffer, filename: string, jobId?: string) {
  try { return await factsFromText(tdb, await extractResumeText(buf, filename), jobId); }
  catch { return null; }
}

/**
 * Adds what the resume shows to a candidate: skills and certifications are merged in, and title, years and location
 * fill in only where the profile is still empty, so nothing a recruiter typed is overwritten. Returns what changed.
 */
export async function fillFromResume(tdb: TenantDb, candidateId: string, f: ResumeFacts) {
  const c = await tdb.candidate.findFirst({ where: { id: candidateId }, select: { skills: true, certs: true, title: true, yearsExp: true, location: true } });
  if (!c) return null;
  const skills = mergeList(c.skills, f.skills), certs = mergeList(c.certs, f.certs);
  const data = {
    ...(skills.length !== c.skills.length ? { skills } : {}), ...(certs.length !== c.certs.length ? { certs } : {}),
    ...(!c.title && f.title ? { title: f.title } : {}), ...(c.yearsExp == null && f.yearsExp != null ? { yearsExp: f.yearsExp } : {}),
    ...(!c.location && f.location ? { location: f.location } : {}),
  };
  if (Object.keys(data).length) await tdb.candidate.updateMany({ where: { id: candidateId }, data });
  return { addedSkills: skills.slice(c.skills.length), addedCerts: certs.slice(c.certs.length), filled: Object.keys(data).filter((k) => !['skills', 'certs'].includes(k)) };
}

export const describeFill = (r: Awaited<ReturnType<typeof fillFromResume>>) => {
  if (!r) return '';
  const parts = [r.addedSkills.length ? `${r.addedSkills.length} skill${r.addedSkills.length === 1 ? '' : 's'}` : '', r.addedCerts.length ? `${r.addedCerts.length} certification${r.addedCerts.length === 1 ? '' : 's'}` : '',
    ...r.filled.map((k) => ({ title: 'title', yearsExp: 'years of experience', location: 'location' })[k] ?? k)].filter(Boolean);
  return parts.length ? `Added ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')} from the resume.` : 'The resume didn’t add anything new to the profile.';
};
