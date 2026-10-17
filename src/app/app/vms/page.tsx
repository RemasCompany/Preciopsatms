import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import Gate from '@/components/Gate';
import VmsPrograms from '@/components/Vms';
import SetupChecklist from '@/components/SetupChecklist';
import { vmsFacts, vmsSteps } from '@/lib/setup-checklist';

export const dynamic = 'force-dynamic';

export default async function VmsPage() {
  const ctx = await requirePageContext('RECRUITER');
  if (!hasFeature(ctx.org, 'vms')) return <Gate title="VMS programs" feature="VMS programs (Enterprise)" employer={ctx.org.kind === 'EMPLOYER'} />;
  const steps = vmsSteps(await vmsFacts(ctx.tdb));
  const clients = await ctx.tdb.client.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return (
    <>
      <h1>VMS programs</h1>
      <p className="lede">For clients that buy staffing through SAP Fieldglass, Beeline, Workday VNDLY or another VMS: import their requisitions as jobs, send approved time in the program’s upload format, and match remittances to your invoices, VMS fee included.</p>
      {(ctx.role === 'OWNER' || ctx.role === 'ADMIN') && <SetupChecklist id="vms" title="Set up a VMS program" steps={steps} />}
      <VmsPrograms clients={clients} canAdmin={ctx.role === 'OWNER' || ctx.role === 'ADMIN'} />
    </>
  );
}
