import { requireApiContext, withApi } from '@/lib/tenant';
import { authorizeUrl } from '@/lib/checkr';
import { signState } from '@/lib/secret-box';

export const dynamic = 'force-dynamic';

/** Sends an admin to Checkr to sign in to the company's Checkr account (or create one) and connect it. */
export const GET = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'credentials', write: true });
  const mode = new URL(req.url).searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  return Response.redirect(authorizeUrl(signState({ org: org.id, user: user.id, p: 'checkr' }), mode), 302);
});
