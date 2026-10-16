import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import Gate from '@/components/Gate';
import InterviewsBoard from '@/components/Interviews';

export const dynamic = 'force-dynamic';

export default async function InterviewsPage({ searchParams }: { searchParams: { open?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'ats')) return <Gate title="Interviews" feature="Interview scheduling and scorecards" employer={ctx.org.kind === 'EMPLOYER'} />;
  return (
    <>
      <h1>Interviews</h1>
      <p className="lede">Offer candidates times to pick from, send calendar invites, and collect a scorecard from every interviewer. Schedule one from a candidate’s record.</p>
      <InterviewsBoard openId={searchParams.open} />
    </>
  );
}
