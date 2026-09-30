import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { loadInvoice, voidInvoice } from '@/lib/invoicing-server';

const Body = z.object({ action: z.literal('void'), reason: z.string().trim().min(3, 'Say why it’s being voided.').max(300) });

/** Void an invoice (only with no payments). Its hours can then go on a new invoice. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  await voidInvoice(tdb, org, user, await loadInvoice(tdb, params.id), b.data.reason);
  return Response.json({ ok: true });
});
