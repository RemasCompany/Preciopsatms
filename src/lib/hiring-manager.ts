import { z } from 'zod';
import type { Organization, Role, User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';

/**
 * Hiring managers reviewing applicants. Recruiters and up can work any applicant. Someone with the Viewer role can still
 * act on applicants for jobs they are the hiring manager of (the job's "Reports to", matched by the email they sign in
 * with on their employee record): add notes, move them between stages and set up interviews. Hiring someone (Placed or
 * Hired), which creates the employee record or the assignment, stays with recruiters and HR.
 */
type Who = { tdb: TenantDb; user: Pick<User, 'id' | 'email'>; role: Role };

/** Jobs this person is the hiring manager for. */
export async function managedJobIds(tdb: TenantDb, user: Pick<User, 'email'>) {
  const email = user.email.toLowerCase();
  const me = await tdb.employee.findMany({
    where: { status: { not: 'TERMINATED' }, OR: [{ workEmail: { equals: email, mode: 'insensitive' } }, { candidate: { email: { equals: email, mode: 'insensitive' } } }] },
    select: { id: true },
  });
  if (!me.length) return new Set<string>();
  const jobs = await tdb.job.findMany({ where: { managerId: { in: me.map((e) => e.id) } }, select: { id: true } });
  return new Set(jobs.map((j) => j.id));
}

/** Can this person work this applicant (notes, stage moves, interviews)? */
export async function canActOnJob(w: Who, jobId: string, managed?: Set<string>) {
  if (w.role !== 'VIEWER') return true;
  return (managed ?? (await managedJobIds(w.tdb, w.user))).has(jobId);
}

/** For routes: the application, if this person may act on it; otherwise a plain 403. */
export async function requireApplicationActor(w: Who, applicationId: string) {
  const app = await w.tdb.application.findFirst({ where: { id: applicationId }, select: { id: true, jobId: true, candidateId: true } });
  if (!app) throw new HttpError(404, 'That application was deleted.');
  if (!(await canActOnJob(w, app.jobId))) throw new HttpError(403, 'Only recruiters, HR, or this job’s hiring manager can do that.');
  return { ...app, hiringManagerOnly: w.role === 'VIEWER' };
}

// ---------- notes ----------

export const NoteBody = z.object({
  body: z.string().trim().min(1, 'Write the note.').max(4000, 'Keep notes under 4,000 characters.'),
  applicationId: z.string().min(1).max(40).nullish(),
});

export async function listNotes(tdb: TenantDb, candidateId: string, me: Pick<User, 'id'>, role: Role) {
  const rows = await tdb.candidateNote.findMany({ where: { candidateId }, orderBy: { createdAt: 'desc' }, take: 200, include: { application: { select: { job: { select: { title: true } } } } } });
  return rows.map((n) => ({ id: n.id, body: n.body, author: n.authorName, at: n.createdAt.toISOString(), applicationId: n.applicationId, job: n.application?.job.title ?? null,
    canDelete: n.authorId === me.id || role === 'OWNER' || role === 'ADMIN' }));
}

export async function addNote(w: Who & { org: Organization; user: User }, candidateId: string, raw: unknown) {
  const p = NoteBody.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const c = await w.tdb.candidate.findFirst({ where: { id: candidateId }, select: { id: true, name: true } });
  if (!c) throw new HttpError(404, 'That candidate was deleted.');
  let applicationId: string | null = null;
  if (p.data.applicationId) {
    const app = await requireApplicationActor(w, p.data.applicationId);
    if (app.candidateId !== c.id) throw new HttpError(400, 'That application belongs to someone else.');
    applicationId = app.id;
  } else if (w.role === 'VIEWER') throw new HttpError(403, 'Choose the job this note is about.');
  const n = await w.tdb.candidateNote.create({ data: { candidateId: c.id, applicationId, authorId: w.user.id, authorName: w.user.name ?? w.user.email, body: p.data.body } as never });
  await logActivity(w.org.id, `${w.user.name ?? w.user.email} added a note on ${c.name}`, w.user.id);
  return { id: n.id };
}

export async function deleteNote(w: Who, candidateId: string, noteId: string) {
  const n = await w.tdb.candidateNote.findFirst({ where: { id: noteId, candidateId } });
  if (!n) throw new HttpError(404, 'That note was already deleted.');
  if (n.authorId !== w.user.id && w.role !== 'OWNER' && w.role !== 'ADMIN') throw new HttpError(403, 'Only the person who wrote it, or an admin, can delete a note.');
  await w.tdb.candidateNote.deleteMany({ where: { id: n.id } });
  return { ok: true };
}
