import { cronRoute } from '@/lib/cron';
import { runShiftReminders } from '@/lib/schedule-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily job: reminds workers about tomorrow's shifts. Needs CRON_SECRET. */
export const GET = cronRoute('shift-reminders', () => runShiftReminders());
