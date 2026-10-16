import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { previewInvoice } from '@/lib/invoicing-server';

const Q = z.object({ clientId: z.string().min(1, 'Choose a client.'), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.') })
  .refine((q) => q.from <= q.to, { message: 'The period’s start is after its end.' });

/** The hours and billing defaults a new invoice for this client and period would start with. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'invoicing' });
  const q = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw new HttpError(400, q.error.issues[0]?.message ?? 'Invalid input');
  return Response.json(await previewInvoice(tdb, q.data.clientId, q.data.from, q.data.to));
});
