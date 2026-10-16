import { cronRoute } from '@/lib/cron';
import { runPeopleDaily } from '@/lib/people';
import { runLeaveAccruals } from '@/lib/leave';
import { runReviewReminders } from '@/lib/review-schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily: future-dated raises and last days take effect, time off accrues, and reviews coming due are added and their managers reminded. Needs CRON_SECRET. */
export const GET = cronRoute('people', async () => ({ ...(await runPeopleDaily()), ...(await runLeaveAccruals()), reviews: await runReviewReminders() }));
