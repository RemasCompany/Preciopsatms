import { cronRoute } from '@/lib/cron';
import { runBirthdayGreetings } from '@/lib/engagement-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily job: birthday greetings for workers on assignment (companies that turned them on). Needs CRON_SECRET. */
export const GET = cronRoute('engagement', () => runBirthdayGreetings());
