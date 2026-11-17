import { cronRoute } from '@/lib/cron';
import { runPeopleDaily } from '@/lib/people';
import { runLeaveAccruals } from '@/lib/leave';
import { runReviewReminders } from '@/lib/review-schedule';
import { runTaskReminders } from '@/lib/task-reminders';
import { runTrialLifecycle } from '@/lib/trials';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily: future-dated raises and last days take effect, time off accrues, reviews coming due are added and their managers reminded, tasks due soon or overdue are sent to their owners, and free trials get their ending emails and end (read-only). Needs CRON_SECRET. */
export const GET = cronRoute('people', async () => ({ ...(await runPeopleDaily()), ...(await runLeaveAccruals()), reviews: await runReviewReminders(), tasks: await runTaskReminders(), trials: await runTrialLifecycle() }));
