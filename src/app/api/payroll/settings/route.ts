import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { db } from '@/lib/db';
import { EXPORT_FORMATS } from '@/lib/payroll-run';

const Body = z.object({
  provider: z.union([z.enum(Object.keys(EXPORT_FORMATS) as [keyof typeof EXPORT_FORMATS]), z.null()]),
  companyCode: z.union([z.string().trim().max(20, 'Company codes are at most 20 characters.').regex(/^[\w-]*$/, 'Use letters, numbers and dashes only.'), z.null()]),
});

/** The org's default payroll provider and company code (organization settings, not tenant business data). */
export const PATCH = withApi(async (req: Request) => {
  const { org } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  await db.organization.update({ where: { id: org.id }, data: { payrollProvider: r.data.provider, payrollCompanyCode: r.data.companyCode || null } });
  return Response.json({ ok: true });
});
