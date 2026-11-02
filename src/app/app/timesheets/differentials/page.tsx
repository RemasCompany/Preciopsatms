import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { listRules } from '@/lib/differentials-server';
import Gate from '@/components/Gate';
import PayRules from '@/components/PayRules';

export default async function DifferentialsPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'timesheets')) return <Gate title="Pay differentials" feature="Timesheets and payroll" />;
  const staffing = ctx.org.kind !== 'EMPLOYER';
  const [rules, clients, jobs] = await Promise.all([
    listRules(ctx.tdb),
    staffing ? ctx.tdb.client.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }) : [],
    ctx.tdb.job.findMany({ where: { status: { in: ['OPEN', 'ON_HOLD', 'FILLED'] } }, select: { id: true, title: true, client: { select: { name: true } } }, orderBy: { title: 'asc' }, take: 500 }),
  ]);
  const admin = (ctx.role === 'OWNER' || ctx.role === 'ADMIN') && canEdit(ctx);
  return (
    <>
      <p className="muted" style={{ margin: 0 }}><Link href="/app/timesheets">← Timesheets</Link></p>
      <h1>Pay differentials</h1>
      <p className="lede">Extra pay{staffing ? ' (and bill)' : ''} for nights, weekends, holidays, on-call, call-back, charge shifts and crisis incentives. Set them company-wide{staffing ? ', or for one client or job — the most specific one wins' : ' or for one job'}. Premium hours go on each week’s timesheet, entered by hand or worked out from the time clock, with the rates saved at entry. Night, charge, on-call and incentive pay count toward the overtime rate, as federal law requires; 1.5× weekend and holiday premiums don’t.</p>
      <PayRules rules={rules} clients={clients} jobs={jobs.map((j) => ({ id: j.id, title: j.client ? `${j.title} — ${j.client.name}` : j.title }))} canEdit={admin} staffing={staffing} healthcare={ctx.org.industry === 'HEALTHCARE'} />
    </>
  );
}
