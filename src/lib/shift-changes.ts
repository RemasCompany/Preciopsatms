import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb } from './tenant';
import { clock, dayLabel } from './schedule';
import { deliver } from './schedule-server';

/**
 * Shift change requests from the employee app: a worker asks to give up a shift or to change it, a manager approves or
 * declines on the Schedule page, and the worker hears back. Approving a give-up cancels the shift; a change is made by
 * editing the shift as usual (and republishing).
 */
const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const KINDS = { DROP: 'give up this shift', CHANGE: 'change this shift' } as const;

export const RequestBody = z.object({
  changeShiftId: z.string().min(1),
  kind: z.enum(['DROP', 'CHANGE']),
  note: z.string().trim().max(500, 'Keep it under 500 characters.').optional(),
}).refine((b) => b.kind === 'DROP' || (b.note ?? '').length >= 3, { message: 'Say what you’d like changed (for example, “start at 9 instead of 7”).' });

export const DecideBody = z.object({ approve: z.boolean(), reply: z.string().trim().max(500, 'Keep the reply under 500 characters.').optional() });

const when = (s: { date: Date; start: string; end: string }) => `${dayLabel(ymd(s.date))} ${clock(s.start)}–${clock(s.end)}`;

/** The worker asks. One open request per shift. */
export async function requestChange(orgId: string, candidate: { id: string; name: string }, raw: unknown) {
  const p = RequestBody.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const tdb = tenantDb(orgId);
  const s = await tdb.shift.findFirst({ where: { id: p.data.changeShiftId, application: { candidateId: candidate.id } } });
  if (!s) throw new HttpError(404, 'That shift isn’t on your schedule.');
  if (s.cancelled) throw new HttpError(409, 'That shift was cancelled.');
  if (!s.notified) throw new HttpError(409, 'This shift is being updated. You’ll get the new details shortly.');
  if (ymd(s.date) < ymd(new Date())) throw new HttpError(409, 'That shift has already passed.');
  if (await tdb.shiftChangeRequest.findFirst({ where: { shiftId: s.id, status: 'PENDING' } })) throw new HttpError(409, 'You already asked about this shift. Your manager will get back to you.');
  const note = p.data.note?.trim() || null;
  const r = await tdb.shiftChangeRequest.create({ data: { shiftId: s.id, candidateId: candidate.id, kind: p.data.kind, note } as never });
  const what = `${candidate.name} asked to ${KINDS[p.data.kind]} (${when(s)})${note ? `: “${note}”` : ''}`;
  await logActivity(orgId, what);
  // On the team's task list (and in their reminders) until someone answers on the Schedule page.
  await tdb.task.create({ data: { title: `${what.slice(0, 250)}. Answer on the Schedule page.`, related: `shiftchange:${r.id}`, priority: 'High', dueAt: new Date(Math.min(s.date.getTime(), Date.now() + 864e5)) } as never });
  return { ok: true, message: p.data.kind === 'DROP' ? 'Sent. We’ll let you know once your manager answers. Until then, the shift is still yours.' : 'Sent. We’ll let you know once your manager answers.' };
}

/** Requests waiting for an answer, for the Schedule page. */
export async function pendingChanges(orgId: string) {
  const rows = await tenantDb(orgId).shiftChangeRequest.findMany({
    where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' },
    include: { shift: { select: { date: true, start: true, end: true, unit: true, application: { select: { candidate: { select: { name: true } }, job: { select: { title: true } } } } } } },
  });
  return rows.map((r) => ({ id: r.id, kind: r.kind as keyof typeof KINDS, note: r.note, worker: r.shift.application.candidate.name, job: r.shift.application.job.title, unit: r.shift.unit,
    date: ymd(r.shift.date), start: r.shift.start, end: r.shift.end, asked: r.createdAt.toISOString() }));
}

/** A manager answers; the worker is told by email (or text), honoring opt-outs. */
export async function decideChange(org: Organization, user: User, id: string, raw: unknown) {
  const p = DecideBody.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const tdb = tenantDb(org.id);
  const r = await tdb.shiftChangeRequest.findFirst({ where: { id }, include: { shift: true } });
  if (!r) throw new HttpError(404, 'That request is gone.');
  if (r.status !== 'PENDING') throw new HttpError(409, 'Someone already answered this request.');
  const reply = p.data.reply?.trim() || null;
  const status = p.data.approve ? 'APPROVED' : 'DECLINED';
  // Only the first answer counts if two managers click at once.
  const won = await tdb.shiftChangeRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status, reply, decidedById: user.id, decidedAt: new Date() } });
  if (!won.count) throw new HttpError(409, 'Someone already answered this request.');
  if (p.data.approve && r.kind === 'DROP') await tdb.shift.updateMany({ where: { id: r.shiftId }, data: { cancelled: true, notified: true, notifiedAt: new Date() } });
  await tdb.task.updateMany({ where: { related: `shiftchange:${id}`, done: false }, data: { done: true, doneAt: new Date() } });

  const w = await tdb.candidate.findFirst({ where: { id: r.candidateId }, select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } });
  const company = org.shortName ?? org.name;
  const shift = when(r.shift);
  const outcome = !p.data.approve ? `isn’t approved, so the shift (${shift}) stays on your schedule.`
    : r.kind === 'DROP' ? `is approved. You’re off the ${shift} shift.` : `is approved. Your updated shift details will follow.`;
  const text = [`Hi ${w?.name.split(' ')[0] ?? 'there'},`, '', `Your request to ${KINDS[r.kind as keyof typeof KINDS]} ${outcome}`, ...(reply ? ['', `Note from ${user.name ?? 'your manager'}: ${reply}`] : []), '', `— ${company}`].join('\n');
  const problem = w ? await deliver(tdb, w, w.email ? 'email' : 'sms', { subject: `Your shift request: ${p.data.approve ? 'approved' : 'not approved'}`, text }, { name: company, replyTo: user.email }, user.id) : 'no worker';
  await logActivity(org.id, `${p.data.approve ? 'Approved' : 'Declined'} ${w?.name ?? 'a worker'}’s request to ${KINDS[r.kind as keyof typeof KINDS]} (${shift})`, user.id);
  return { ok: true, told: !problem, problem, cancelled: p.data.approve && r.kind === 'DROP' };
}

/** The latest request on each of a worker's shifts, for their page. */
export async function workerChanges(orgId: string, shiftIds: string[]) {
  if (!shiftIds.length) return new Map<string, { kind: string; status: string; reply: string | null }>();
  const rows = await tenantDb(orgId).shiftChangeRequest.findMany({ where: { shiftId: { in: shiftIds } }, orderBy: { createdAt: 'asc' } });
  return new Map(rows.map((r) => [r.shiftId, { kind: r.kind, status: r.status, reply: r.reply }]));
}
