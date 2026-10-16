import { requireApiContext, withApi } from '@/lib/tenant';
import { cancelDoc, reviewDoc } from '@/lib/hiring-docs-server';

type Ctx = { params: { id: string } };

/** Accept a document, or send it back with a reason: { action: 'accept' | 'reject', note?, channels? }. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  return Response.json(await reviewDoc(tdb, org, user, params.id, await req.json().catch(() => null)));
});

/** Withdraw a request nothing has been sent for yet. */
export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  return Response.json(await cancelDoc(tdb, org, user, params.id));
});
