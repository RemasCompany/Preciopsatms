import { requireApiContext, withApi } from '@/lib/tenant';
import { listInterviews, proposeInterview, type InterviewView } from '@/lib/interviews-server';
import { requireApplicationActor } from '@/lib/hiring-manager';

const VIEWS: InterviewView[] = ['upcoming', 'feedback', 'waiting', 'past'];

/** ?view=upcoming|feedback|waiting|past&mine=1, or ?candidate=<id> for one person's interviews. */
export const GET = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ feature: 'ats' });
  const q = new URL(req.url).searchParams;
  const view = VIEWS.includes(q.get('view') as InterviewView) ? (q.get('view') as InterviewView) : 'upcoming';
  return Response.json(await listInterviews(ctx, view, q.get('mine') === '1', { candidateId: q.get('candidate') ?? undefined }));
});

/** Offer the candidate times to pick from (or set one), with calendar invites once it's booked. */
export const POST = withApi(async (req: Request) => {
  // Recruiters and up, or this job's hiring manager.
  const ctx = await requireApiContext({ feature: 'ats', write: true });
  const body = await req.json().catch(() => null);
  await requireApplicationActor(ctx, String((body as { applicationId?: unknown } | null)?.applicationId ?? ''));
  return Response.json(await proposeInterview(ctx, body), { status: 201 });
});
