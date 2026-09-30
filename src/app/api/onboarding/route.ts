import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { startOnboarding } from '@/lib/onboarding-server';

const Body = z.object({
  applicationId: z.string().min(1, 'Choose the new hire.'),
  packageId: z.string().min(1, 'Choose an onboarding package.'),
  startDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid start date.'), z.null()]).optional(),
});

/** Start onboarding a new hire with a package. Documents are drafted with their details; nothing is sent yet. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'onboarding', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const ob = await startOnboarding(org, user, r.data);
  return Response.json({ id: ob.id }, { status: 201 });
});
