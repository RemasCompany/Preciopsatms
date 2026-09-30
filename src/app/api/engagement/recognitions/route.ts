import { requireApiContext, withApi } from '@/lib/tenant';
import { RecognitionBody, giveRecognition, parse } from '@/lib/engagement-server';

/** Recognize a worker; optionally tell them by text or email and show it on their page. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'engagement', write: true });
  return Response.json(await giveRecognition(org, user, parse(RecognitionBody, await req.json().catch(() => null))), { status: 201 });
});
