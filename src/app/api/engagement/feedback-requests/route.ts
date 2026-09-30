import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { parse, requestClientFeedback } from '@/lib/engagement-server';

/** Email a client contact a one-time link to rate a worker. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'engagement', write: true });
  const b = parse(z.object({ applicationId: z.string().min(1), contactId: z.string().min(1, 'Choose a contact.') }), await req.json().catch(() => null));
  return Response.json(await requestClientFeedback(org, user, b.applicationId, b.contactId), { status: 201 });
});
