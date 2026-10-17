import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { OfferBody, recordOffer } from '@/lib/aca-server';

/** Record an offer of health coverage (proof for the ACA and data for Form 1095-C). */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'aca', write: true });
  const p = OfferBody.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  return Response.json({ ok: true, id: await recordOffer(tdb, org, user, p.data) }, { status: 201 });
});
