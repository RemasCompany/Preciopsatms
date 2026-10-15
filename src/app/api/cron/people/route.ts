import { cronRoute } from '@/lib/cron';
import { runPeopleDaily } from '@/lib/people';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily: future-dated raises and last days take effect. Needs CRON_SECRET. */
export const GET = cronRoute('people', () => runPeopleDaily());
