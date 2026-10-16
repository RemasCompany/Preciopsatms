import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { DetailsBody, loadInvoice, updateDraft, voidInvoice } from '@/lib/invoicing-server';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('void'), reason: z.string().trim().min(3, 'Say why it’s being voided.').max(300) }),
  DetailsBody.extend({ action: z.literal('details') }),
]);

/** Void an invoice (only with no payments; its hours can then go on a new invoice), or change a draft's details before it's sent. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'invoicing', write: true });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const inv = await loadInvoice(tdb, params.id);
  if (b.data.action === 'void') await voidInvoice(tdb, org, user, inv, b.data.reason);
  else { const { action: _a, ...details } = b.data; await updateDraft(tdb, org, user, inv, details); }
  return Response.json({ ok: true });
});
