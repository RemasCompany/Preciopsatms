import { timingSafeEqual } from 'crypto';
import { runBirthdayGreetings } from '@/lib/engagement-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily job: birthday greetings for workers on assignment (companies that turned them on). Needs CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await runBirthdayGreetings());
}
