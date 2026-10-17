import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { form1095Csv } from '@/lib/aca-server';
import { audit } from '@/lib/audit';

/** Suggested Form 1095-C lines 14–16 for a calendar year, as CSV. */
export const GET = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'aca' });
  const year = Number(new URL(req.url).searchParams.get('year'));
  if (!Number.isInteger(year) || year < 2015 || year > new Date().getUTCFullYear()) throw new HttpError(400, 'Choose a year.');
  const r = await form1095Csv(tdb, year);
  await audit(org.id, user, 'data.export', `Downloaded Form 1095-C data for ${year} (${r.people} people)`, { req });
  return new Response(r.csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="1095c-data-${year}.csv"` } });
});
