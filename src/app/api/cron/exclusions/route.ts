import { cronRoute } from '@/lib/cron';
import { runExclusionScreening } from '@/lib/exclusions-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily job: screens companies that are due (monthly, or with new workers) against the OIG exclusion list. Needs CRON_SECRET. */
export const GET = cronRoute('exclusions', () => runExclusionScreening());
