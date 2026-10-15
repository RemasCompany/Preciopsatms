import { requireApiContext, withApi } from '@/lib/tenant';
import { saveTemplate } from '@/lib/offboarding';

/** The company's offboarding checklist, used for each departure from now on. Owners and admins. */
export const PUT = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'people', write: true });
  return Response.json(await saveTemplate(ctx, await req.json().catch(() => null)));
});
