import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { parsePackage } from '@/lib/onboarding-server';
import { STARTER_PACKAGES } from '@/lib/onboarding';

/** Create a package, either from scratch or from one of the starter packages ({ starter: index }). */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'onboarding', write: true });
  const body = await req.json().catch(() => null);
  const starter = z.object({ starter: z.number().int().min(0).max(STARTER_PACKAGES.length - 1) }).safeParse(body);
  const data = starter.success ? STARTER_PACKAGES[starter.data.starter] : parsePackage(body);
  if (await tdb.onboardingPackage.findFirst({ where: { name: data.name, archived: false } })) throw new HttpError(409, `You already have a package called “${data.name}”.`);
  const pkg = await tdb.onboardingPackage.create({ data: { name: data.name, description: data.description ?? null, steps: data.steps } as never });
  await logActivity(org.id, `Created onboarding package ${pkg.name}`, user.id);
  return Response.json({ id: pkg.id }, { status: 201 });
});
