import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { getAudit, listAudits } from '@/lib/hr-audit-server';
import HrAudit from '@/components/HrAudit';
import Gate from '@/components/Gate';

export default async function HrAuditPage({ searchParams }: { searchParams: { id?: string } }) {
  const ctx = await requirePageContext();
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return (<><h1>HR audit</h1><p className="card">Only owners and admins can see this page.</p></>);
  if (!hasFeature(ctx.org, 'hrAudit')) return <Gate title="HR audit" feature="HR internal audits" />;
  const audits = await listAudits(ctx.tdb);
  const pick = audits.find((a) => a.id === searchParams.id) ?? audits.find((a) => a.status === 'OPEN') ?? audits[0];
  return (
    <>
      <h1>HR audit</h1>
      <p className="lede">A regular check of your HR records and practices: Form I-9s, pay, paperwork, credentials, reviews and offboarding are checked from your records, and a checklist covers the rest. Fix what you can, note what’s handled elsewhere, then complete the audit to keep a dated record.</p>
      {/* Keyed by audit, so opening another one (or the one just started) shows it fresh. */}
      <HrAudit key={pick?.id ?? 'none'} audits={audits} current={pick ? await getAudit(ctx, pick.id) : null} />
    </>
  );
}
