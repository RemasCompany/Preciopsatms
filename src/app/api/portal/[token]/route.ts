import { HttpError, withApi } from '@/lib/tenant';
import { limited } from '@/lib/rate-limit';
import { portalAct, portalData, resolvePortal } from '@/lib/portal-server';

export const dynamic = 'force-dynamic';
type Ctx = { params: { token: string } };
const GONE = 'This link has expired or was turned off. Ask for a new one below.';

/** Public: the client portal behind a contact's private link. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  if (await limited('portal', params.token.slice(0, 20), 120, 600e3)) throw new HttpError(429, 'Too many requests. Try again in a few minutes.');
  const p = await resolvePortal(params.token);
  if (!p) throw new HttpError(404, GONE);
  return Response.json(await portalData(p), { headers: { 'Cache-Control': 'private, no-store' } });
});

/** Approve or question hours, rate a worker, or request staff. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  if (await limited('portal-act', params.token.slice(0, 20), 60, 600e3)) throw new HttpError(429, 'Too many requests. Try again in a few minutes.');
  const p = await resolvePortal(params.token);
  if (!p) throw new HttpError(404, GONE);
  if (!['trialing', 'active'].includes(p.org.subscriptionStatus)) throw new HttpError(402, `${p.org.shortName ?? p.org.name}’s account is paused. Contact them directly.`);
  return Response.json(await portalAct(p, await req.json().catch(() => null)));
});
