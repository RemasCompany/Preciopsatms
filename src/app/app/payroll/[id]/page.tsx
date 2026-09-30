import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageContext, canEdit, HttpError } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { checksFor, loadRun } from '@/lib/payroll-run-server';
import { byWorker, totals } from '@/lib/payroll-run';
import PayrollRunView from '@/components/PayrollRun';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';

export default async function PayrollRunPage({ params }: { params: { id: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'payrollRuns')) return <Gate title="Payroll runs" feature="Payroll runs (Enterprise)" />;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return <div className="card empty"><b>Payroll is limited to admins</b>Ask an owner or admin on your team for access.</div>;
  let loaded;
  try { loaded = await loadRun(ctx.tdb, params.id); } catch (e) { if (e instanceof HttpError) notFound(); throw e; }
  const checks = await checksFor(ctx.tdb, loaded);
  const clients = [...new Map(loaded.items.filter((i) => i.clientId).map((i) => [i.clientId!, i.clientName!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <>
      <p className="muted" style={{ margin: 0 }}><Link href="/app/payroll">← Payroll runs</Link></p>
      <PayrollRunView
        run={{ ...loaded.meta, id: loaded.run.id, status: loaded.run.status, frequency: loaded.run.frequency, approvedAt: loaded.run.approvedAt?.toISOString() ?? null, paidAt: loaded.run.paidAt?.toISOString() ?? null }}
        workers={byWorker(loaded.items)} totals={totals(loaded.items)} checks={checks} clients={clients}
        provider={ctx.org.payrollProvider} canEdit={canEdit(ctx)}
      />
    </>
  );
}
