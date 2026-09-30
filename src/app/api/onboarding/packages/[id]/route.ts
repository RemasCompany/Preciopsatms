import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { parsePackage } from '@/lib/onboarding-server';

type Ctx = { params: { id: string } };

/** Edit a package. New hires already onboarding keep the steps they started with. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'onboarding', write: true });
  const pkg = await tdb.onboardingPackage.findFirst({ where: { id: params.id, archived: false } });
  if (!pkg) throw new HttpError(404, 'That package was deleted.');
  const data = parsePackage(await req.json().catch(() => null));
  if (data.name !== pkg.name && await tdb.onboardingPackage.findFirst({ where: { name: data.name, archived: false, id: { not: pkg.id } } })) throw new HttpError(409, `You already have a package called “${data.name}”.`);
  await tdb.onboardingPackage.updateMany({ where: { id: pkg.id }, data: { name: data.name, description: data.description ?? null, steps: data.steps } });
  await logActivity(org.id, `Updated onboarding package ${data.name}`, user.id);
  return Response.json({ ok: true });
});

/** Archive a package (history keeps its name). */
export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'onboarding', write: true });
  const pkg = await tdb.onboardingPackage.findFirst({ where: { id: params.id, archived: false } });
  if (!pkg) throw new HttpError(404, 'That package was deleted.');
  await tdb.onboardingPackage.updateMany({ where: { id: pkg.id }, data: { archived: true } });
  await logActivity(org.id, `Archived onboarding package ${pkg.name}`, user.id);
  return Response.json({ ok: true });
});
