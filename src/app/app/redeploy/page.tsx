import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import Gate from '@/components/Gate';
import RedeployBoard from '@/components/Redeploy';

export const dynamic = 'force-dynamic';

export default async function RedeployPage() {
  const ctx = await requirePageContext('RECRUITER');
  if (!hasFeature(ctx.org, 'ats') || ctx.org.kind === 'EMPLOYER') return <Gate title="Redeployment" feature="Redeployment" employer={ctx.org.kind === 'EMPLOYER'} />;
  return (
    <>
      <h1>Redeployment</h1>
      <p className="lede">Workers whose assignment ends in the next two weeks, or ended without a next one, and the open jobs they fit best. Line up their next assignment before another agency does.</p>
      <RedeployBoard />
    </>
  );
}
