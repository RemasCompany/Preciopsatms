import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';

const Body = z.object({
  clientId: z.string().min(1),
  mode: z.enum(['ask', 'package', 'none']),
  packageId: z.string().optional().nullable(),
});

/** Per client: recruiters choose a package each time, one package is always used, or onboarding isn't required. */
export const PATCH = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'onboarding', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, 'Invalid input');
  const client = await tdb.client.findFirst({ where: { id: r.data.clientId } });
  if (!client) throw new HttpError(404, 'That client was deleted.');
  let packageId: string | null = null;
  if (r.data.mode === 'package') {
    const pkg = r.data.packageId ? await tdb.onboardingPackage.findFirst({ where: { id: r.data.packageId, archived: false } }) : null;
    if (!pkg) throw new HttpError(400, 'Choose the package this client always uses.');
    packageId = pkg.id;
  }
  await tdb.client.updateMany({ where: { id: client.id }, data: { onboardingMode: r.data.mode, onboardingPackageId: packageId } });
  await logActivity(org.id, `Onboarding for ${client.name}: ${r.data.mode === 'none' ? 'not required' : r.data.mode === 'ask' ? 'recruiter chooses' : 'always uses a set package'}`, user.id);
  return Response.json({ ok: true });
});
