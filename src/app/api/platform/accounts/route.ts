import { withApi } from '@/lib/tenant';
import { accounts, accountsCsv, isFilter, requirePlatformApi } from '@/lib/platform';

export const dynamic = 'force-dynamic';

/** The accounts list as CSV (?filter=, ?q=), for platform admins only. */
export const GET = withApi(async (req: Request) => {
  await requirePlatformApi();
  const u = new URL(req.url);
  const f = u.searchParams.get('filter');
  const rows = await accounts({ filter: isFilter(f) ? f : 'all', q: u.searchParams.get('q') ?? undefined });
  return new Response(accountsCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="preciops-accounts-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
});
