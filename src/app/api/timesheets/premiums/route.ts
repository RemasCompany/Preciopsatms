import { requireApiContext, withApi } from '@/lib/tenant';
import { AddBody, addPremium, premiumsFor } from '@/lib/differentials-server';

export const dynamic = 'force-dynamic';

/** A week's premium lines for one assignment, and the differentials that apply to it. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ feature: 'timesheets' });
  const q = new URL(req.url).searchParams;
  return Response.json(await premiumsFor(tdb, q.get('applicationId') ?? '', q.get('week') ?? ''));
});

/** Add premium hours (night, weekend, on-call…) to a week's timesheet. */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'timesheets', write: true });
  const b = AddBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  await addPremium(ctx, b.data);
  return Response.json({ ok: true }, { status: 201 });
});
