import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Uptime check for load balancers and monitors: 200 when the app can reach its database. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, time: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'database unreachable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
