import { requireApiContext, withApi } from '@/lib/tenant';
import { BRANCH_COOKIE } from '@/lib/branches';

/** The branch switcher: remembers the choice and goes back to the page it came from. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({});
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? 'all';
  const back = u.searchParams.get('back') ?? '/app';
  const safeBack = /^\/app(\/[\w\-/]*)?(\?[\w=&%.-]*)?$/.test(back) ? back : '/app';
  const ok = id === 'all' || !!(await tdb.branch.findFirst({ where: { id }, select: { id: true } }));
  const res = new Response(null, { status: 303, headers: { Location: safeBack } });
  res.headers.append('Set-Cookie', `${BRANCH_COOKIE}=${ok ? id : 'all'}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`);
  return res;
});
