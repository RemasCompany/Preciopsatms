import { cronRoute } from '@/lib/cron';
import { runPeopleDaily } from '@/lib/people';
import { runLeaveAccruals } from '@/lib/leave';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily: future-dated raises and last days take effect, and time off accrues. Needs CRON_SECRET. */
export const GET = cronRoute('people', async () => ({ ...(await runPeopleDaily()), ...(await runLeaveAccruals()) }));
