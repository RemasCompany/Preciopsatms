import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { loadRun } from '@/lib/payroll-run-server';
import { cents, dollars } from '@/lib/payroll-run';
import { renderInvoicePdf } from '@/lib/pdf';

export const dynamic = 'force-dynamic';

/** Invoice one client for the hours in an approved or paid run (bill rates snapshotted with the timesheets). */
export const GET = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns' });
  const clientId = new URL(req.url).searchParams.get('client');
  const { run, items, meta } = await loadRun(tdb, params.id);
  if (run.status !== 'APPROVED' && run.status !== 'PAID') throw new HttpError(409, 'Approve the run before invoicing from it.');
  const client = clientId ? await tdb.client.findFirst({ where: { id: clientId } }) : null;
  if (!client) throw new HttpError(404, 'Client not found');
  const mine = items.filter((i) => i.clientId === client.id);
  if (!mine.length) throw new HttpError(404, 'This run has no hours for that client.');
  const days = parseInt(client.paymentTerms.replace(/\D/g, ''), 10) || 30;
  const due = new Date(`${meta.periodEnd}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + days);
  const number = `INV-${run.number.replace('PR-', '')}-${client.name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}`;
  const lines = mine.map((i) => ({ worker: i.workerName, position: `${i.position} (wk ${i.weekEnding.slice(5)})`, reg: i.regularHours, ot: i.overtimeHours, rate: i.billRate,
    amount: dollars(cents(i.regularHours * i.billRate) + cents(i.overtimeHours * i.billRate * 1.5)) }));
  const pdf = await renderInvoicePdf({ number, company: org.name, city: org.city, client: client.name, clientCity: client.city, terms: client.paymentTerms,
    weekEnding: meta.periodEnd, period: `${meta.periodStart} to ${meta.periodEnd}`, due: due.toISOString().slice(0, 10), lines });
  await logActivity(org.id, `Invoice ${number} generated for ${client.name} from ${run.number}`, user.id);
  return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${number}.pdf"`, 'Cache-Control': 'private, no-store' } });
});
