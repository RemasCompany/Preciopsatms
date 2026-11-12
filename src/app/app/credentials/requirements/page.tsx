import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { jobReadiness } from '@/lib/requirements-server';
import Gate from '@/components/Gate';
import CredentialTabs from '@/components/CredentialTabs';
import JobRequirements from '@/components/JobRequirements';

export default async function RequirementsPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'credentials')) return <Gate title="Credentials" feature="Credential tracking" />;
  const jobs = await jobReadiness(ctx.tdb, ctx.org);
  const admin = (ctx.role === 'OWNER' || ctx.role === 'ADMIN') && canEdit(ctx);
  return (
    <>
      <h1>Credentials</h1>
      <CredentialTabs at="/app/credentials/requirements" />
      <p className="lede">Set what each job needs — licenses, certifications, health records and screenings. Nobody can be offered, placed or scheduled on the job without them, current and verified, through the shift’s date. A state license must be from the job’s state; a multistate (compact) nursing license counts in compact states. An owner or admin can override with a reason, which is saved in the audit log.</p>
      <JobRequirements jobs={jobs} canEdit={admin} />
    </>
  );
}
