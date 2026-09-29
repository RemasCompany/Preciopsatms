import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { parseWeek, ymd } from '@/lib/weeks';
import { hoursAmount } from '@/lib/payroll';
import { renderInvoicePdf } from '@/lib/pdf';

// Per-user data: never pre-render or cache.
export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets' });
  const u = new URL(req.url); const week = parseWeek(u.searchParams.get('week')); const clientId = u.searchParams.get('client');
  const client = clientId ? await tdb.client.findFirst({ where: { id: clientId } }) : null;
  if (!client) throw new HttpError(404, 'Client not found');
  const ts = await tdb.timesheet.findMany({ where: { weekEnding: week, status: { in: ['APPROVED', 'PAID'] }, application: { job: { clientId: client.id } } }, include: { application: { include: { candidate: true, job: true } } } });
  if (!ts.length) throw new HttpError(404, 'No approved hours for this client and week');
  const days = parseInt(client.paymentTerms.replace(/\D/g, ''), 10) || 30;
  const due = new Date(week); due.setUTCDate(due.getUTCDate() + days);
  const number = `INV-${ymd(week).replace(/-/g, '')}-${client.name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}`;
  const lines = ts.map((t) => { const bill = Number(t.billRate), reg = Number(t.regularHours), ot = Number(t.overtimeHours);
    return { worker: t.application.candidate.name, position: t.application.job.title, reg, ot, rate: bill, amount: hoursAmount(reg, ot, bill) }; });
  const pdf = await renderInvoicePdf({ number, company: org.name, city: org.city, client: client.name, clientCity: client.city, terms: client.paymentTerms, weekEnding: ymd(week), due: ymd(due), lines });
  await logActivity(org.id, `Invoice ${number} generated for ${client.name}`, user.id);
  return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${number}.pdf"` } });
});
