import { cronRoute } from '@/lib/cron';
import { runInvoiceReminders } from '@/lib/invoice-reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily: payment reminders for emailed invoices still owed, at companies that switched them on. Needs CRON_SECRET. */
export const GET = cronRoute('invoices', runInvoiceReminders);
