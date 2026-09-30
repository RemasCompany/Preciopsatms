import { cronRoute } from '@/lib/cron';
import { runCredentialAlerts } from '@/lib/credentials-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily job (Vercel Cron, or any scheduler): emails recruiters about credentials nearing expiration. Needs CRON_SECRET. */
export const GET = cronRoute('credential-alerts', () => runCredentialAlerts());
