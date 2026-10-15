import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { BOARDS, isBoard } from '@/lib/boards';

const Body = z.union([
  z.object({ board: z.string().refine(isBoard, 'That job board isn’t supported.'), on: z.boolean() }),
  z.object({ linkedinCompanyId: z.string().trim().max(40).regex(/^\d*$/, 'The LinkedIn company ID is the number in your company page’s admin address.') }),
]);

/** Turn a job board on or off (its feed lists jobs only while it's on), or save the LinkedIn company ID. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'careers', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the setting and try again.');
  if ('linkedinCompanyId' in r.data) {
    await db.organization.update({ where: { id: org.id }, data: { linkedinCompanyId: r.data.linkedinCompanyId || null } });
    await audit(org.id, user, 'settings.job_boards', 'Saved the LinkedIn company ID', { req });
    return Response.json({ ok: true });
  }
  const { board, on } = r.data as { board: keyof typeof BOARDS; on: boolean };
  const next = on ? [...new Set([...org.jobBoards, board])] : org.jobBoards.filter((b) => b !== board);
  await db.organization.update({ where: { id: org.id }, data: { jobBoards: next } });
  await audit(org.id, user, 'settings.job_boards', `${on ? 'Turned on' : 'Turned off'} ${BOARDS[board]}`, { req });
  return Response.json({ ok: true, jobBoards: next });
});
