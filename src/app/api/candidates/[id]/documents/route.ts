import { requireApiContext, withApi } from '@/lib/tenant';
import { candidateDocs, requestDocs } from '@/lib/hiring-docs-server';

type Ctx = { params: { id: string } };

/** Hiring documents asked for and sent. Anyone on the team sees the list; opening sensitive files is checked separately. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, role } = await requireApiContext({});
  return Response.json(await candidateDocs(tdb, params.id, role));
});

/** Ask the candidate for documents: { kinds, other?, channels } — they get a private link to send them. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'onboarding', write: true });
  return Response.json(await requestDocs(tdb, org, user, params.id, await req.json().catch(() => null)));
});
