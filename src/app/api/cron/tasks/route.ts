import { cronRoute } from '@/lib/cron';
import { runDueTasks } from '@/lib/task-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Background queue: finishes queued work (large sends whose browser went away, retries). Needs CRON_SECRET. */
export const GET = cronRoute('tasks', () => runDueTasks());
