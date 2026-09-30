import { HttpError, withApi } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { limited } from '@/lib/rate-limit';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { refer } from '@/lib/referrals';

/** A worker refers a friend from their private link. */
export const POST = withApi(async (req: Request, { params }: { params: { token: string } }) => {
  if (await limited('refer', params.token.slice(0, 20), 10, 3600e3)) throw new HttpError(429, 'That’s a lot of referrals for one hour — try again later.');
  const link = await resolveWorkerLink(params.token);
  if (!link) throw new HttpError(404, 'This link has expired. Ask your recruiter for a new one.');
  if (!hasFeature(link.organization, 'engagement')) throw new HttpError(404, 'Referrals aren’t turned on.');
  return Response.json(await refer(link.organization, link.candidate, await req.json().catch(() => null)));
});
