import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { loadLeie, screenOrg } from '@/lib/exclusions-server';

export const maxDuration = 300;

/** Screen everyone now (downloads the current OIG list). */
export const POST = withApi(async () => {
  const { org } = await requireApiContext({ minRole: 'ADMIN', feature: 'credentials', write: true });
  if (org.exclusionScreenedAt && Date.now() - org.exclusionScreenedAt.getTime() < 5 * 60e3) throw new HttpError(429, 'Screening just ran. Try again in a few minutes.');
  return Response.json(await screenOrg(org, await loadLeie()));
});
