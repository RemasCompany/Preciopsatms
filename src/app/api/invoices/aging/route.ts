import { requireApiContext, withApi } from '@/lib/tenant';
import { toCsv } from '@/lib/csv';
import { BUCKETS, aging, fromCents } from '@/lib/invoicing';
import { openInvoices } from '@/lib/invoicing-server';
import { localDate } from '@/lib/timeclock';

export const dynamic = 'force-dynamic';

/** AR aging by client as CSV. */
export const GET = withApi(async () => {
  const { tdb, org } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets' });
  const today = localDate(new Date(), org.timezone);
  const { rows, totals } = aging(await openInvoices(tdb), today);
  const csv = toCsv([
    ['Client', ...BUCKETS.map((b) => b.label), 'Total open', 'Oldest (days past due)'],
    ...rows.map((r) => [r.client, ...BUCKETS.map((b) => fromCents(r[b.key])), fromCents(r.total), r.oldest]),
    ['Total', ...BUCKETS.map((b) => fromCents(totals[b.key])), fromCents(totals.total), ''],
  ]);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ar-aging-${today}.csv"`, 'Cache-Control': 'private, no-store' } });
});
