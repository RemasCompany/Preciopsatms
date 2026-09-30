import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { syncInvoices } from '@/lib/accounting';

export const maxDuration = 300;

/** Send invoices and their payments to the connected accounting system (all, or the given ones). */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const b = z.object({ invoiceIds: z.array(z.string()).max(200).optional() }).safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, 'Invalid input');
  return Response.json(await syncInvoices(org, user, b.data.invoiceIds));
});
