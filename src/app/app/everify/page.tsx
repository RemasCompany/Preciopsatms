import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { localDate } from '@/lib/timeclock';
import { assignmentWhere } from '@/lib/schedule-server';
import { urgency } from '@/lib/everify';
import EVerifyBoard from '@/components/EVerify';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ORDER = { overdue: 0, due: 1, ok: 2, done: 3 } as const;

export default async function EVerify() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'onboarding')) return <Gate title="E-Verify" feature="E-Verify case tracking" off={!ctx.org.onboardingEnabled} />;
  const today = localDate(new Date(), ctx.org.timezone);
  const [cases, placed] = await Promise.all([
    ctx.tdb.eVerifyCase.findMany({ include: { candidate: { select: { name: true } } }, orderBy: { dueDate: 'asc' }, take: 500 }),
    ctx.tdb.application.findMany({ where: assignmentWhere, select: { candidate: { select: { id: true, name: true } } }, orderBy: { candidate: { name: 'asc' } } }),
  ]);
  const rows = cases.map((c) => ({ id: c.id, name: c.candidate.name, startDate: ymd(c.startDate), dueDate: ymd(c.dueDate), status: c.status, caseNumber: c.caseNumber, notes: c.notes, urgency: urgency({ status: c.status, dueDate: ymd(c.dueDate) }, today) }))
    .sort((a, b) => ORDER[a.urgency] - ORDER[b.urgency] || a.dueDate.localeCompare(b.dueDate));
  const people = [...new Map(placed.map((p) => [p.candidate.id, p.candidate])).values()];
  const overdue = rows.filter((r) => r.urgency === 'overdue').length;
  return (
    <>
      <h1>E-Verify</h1>
      <p className="lede">Track each new hire’s E-Verify case against the three-business-day deadline{overdue ? ` — ${overdue} overdue` : ''}.</p>
      <EVerifyBoard rows={rows} enabled={ctx.org.everifyEnabled} isAdmin={ctx.role === 'OWNER' || ctx.role === 'ADMIN'} canEdit={canEdit(ctx)} people={people} today={today} />
    </>
  );
}
