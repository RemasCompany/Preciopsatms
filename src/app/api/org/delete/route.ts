import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { limited } from '@/lib/rate-limit';
import { DeleteBody, confirmOwner, deleteCompany } from '@/lib/delete-company';

/**
 * Deletes the company and all its data (owner only). Works even when billing has lapsed, so a company can always leave.
 * The owner confirms with the company name, their password and their two-step code if they use one.
 */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'OWNER', twoStepSetup: true });
  if (await limited('delete-company', user.id, 5, 15 * 60e3)) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
  const b = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  await confirmOwner(org, user, b.data);
  return Response.json({ ok: true, ...(await deleteCompany(org, user)) });
});
