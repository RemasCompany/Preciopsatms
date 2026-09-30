import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { createCase } from '@/lib/everify-server';

const Create = z.object({ candidateId: z.string().min(1, 'Choose a person.'), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the first day of work.') });

/** Track an E-Verify case for a new hire. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'onboarding', write: true });
  const b = Create.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const c = await createCase(tdb, org, user, b.data.candidateId, b.data.startDate);
  return Response.json({ id: c.id }, { status: 201 });
});

/** Admins: the company is (or isn't) enrolled in E-Verify; when on, placing someone opens a case to track. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'onboarding', write: true });
  const b = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, 'Invalid input');
  await db.organization.update({ where: { id: org.id }, data: { everifyEnabled: b.data.enabled } });
  await audit(org.id, user, 'settings.onboarding', `Turned E-Verify case tracking ${b.data.enabled ? 'on' : 'off'}`, { changes: { everifyEnabled: [org.everifyEnabled, b.data.enabled] }, req });
  return Response.json({ ok: true });
});
