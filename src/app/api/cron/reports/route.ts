import { cronRoute } from '@/lib/cron';
import { runScheduledReports } from '@/lib/reports-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily job: scheduled report emails (weekly on Mondays, monthly on the 1st). Needs CRON_SECRET. */
export const GET = cronRoute('reports', () => runScheduledReports());
