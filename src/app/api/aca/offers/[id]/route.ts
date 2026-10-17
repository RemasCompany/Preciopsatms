import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { ResponseBody, setResponse } from '@/lib/aca-server';

type Ctx = { params: { id: string } };

/** Record whether the worker accepted or declined the offer. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'aca', write: true });
  const p = ResponseBody.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, 'Choose accepted, declined or no answer yet.');
  await setResponse(tdb, org, user, params.id, p.data);
  return Response.json({ ok: true });
});
