import type { Organization } from '@prisma/client';
import { db } from './db';
import { logActivity, tenantDb } from './tenant';
import { sendEmail } from './email';
import { hasFeature } from './plans';
import { localDate } from './timeclock';
import { ymd } from './weeks';
import { REMINDER_DAYS, reminderStep, usd } from './invoicing';
import { balanceCents, invoicePdf } from './invoicing-server';
import { acceptsOnline, ensurePayToken, payUrl } from './pay-links';

/**
 * Payment reminders (daily, for companies that switch them on). An emailed invoice with money still owed gets a
 * reminder 3 days before it's due, on the due date, then 7, 14, 30, 60 and 90 days past due. Reminders go to the
 * addresses the invoice was emailed to, one email each, with the PDF and the Pay online link; every attempt is logged
 * and contacts who unsubscribed are skipped. Paying, voiding or the last step ends them.
 */
const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function reminderEmail(o: {
  company: string; number: string; client: string; poNumber: string | null; balance: number; due: Date; daysFromDue: number;
  payLink: string | null; cardFeePct: number; remit: string | null; greeting: string;
}) {
  const bal = usd(o.balance), due = fmtDay(o.due), po = o.poNumber ? ` (PO ${o.poNumber})` : '';
  const subject = o.daysFromDue < 0 ? `Reminder: invoice ${o.number}${po} for ${bal} is due ${due}`
    : o.daysFromDue === 0 ? `Invoice ${o.number}${po} for ${bal} is due today`
    : `Past due: invoice ${o.number}${po} for ${bal} was due ${due}`;
  const lead = o.daysFromDue < 0 ? `A friendly reminder that invoice ${o.number} for ${o.client} is due on ${due}.`
    : o.daysFromDue === 0 ? `Invoice ${o.number} for ${o.client} is due today.`
    : `Invoice ${o.number} for ${o.client} was due on ${due} and is now ${o.daysFromDue} day${o.daysFromDue === 1 ? '' : 's'} past due.`;
  const text = [
    `Hi ${o.greeting},`, '', lead, '', `Balance due: ${bal}`, '',
    ...(o.payLink ? [`Pay online: ${o.payLink}`, o.cardFeePct > 0 ? `Bank transfer (ACH) has no fee; cards add a ${o.cardFeePct}% processing fee.` : 'Pay by bank transfer (ACH) or card.', ''] : []),
    ...(o.remit ? [o.payLink ? 'Other ways to pay:' : 'How to pay:', o.remit, ''] : []),
    'The invoice is attached. If you’ve already sent payment, thank you — please disregard this note. Reply with any questions about the invoice.', '',
    'Thank you,', o.company,
  ].join('\n');
  return { subject, text };
}

type Org = Organization;

async function remindOrg(org: Org, now: Date) {
  const tdb = tenantDb(org.id);
  const today = localDate(now, org.timezone);
  const open = await tdb.invoice.findMany({
    where: { status: { in: ['SENT', 'PARTIAL'] }, sentAt: { not: null }, remindersSent: { lt: REMINDER_DAYS.length }, dueDate: { lte: new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 864e5) } },
    include: { client: { include: { contacts: true } }, lines: { orderBy: [{ sortOrder: 'asc' }, { weekEnding: 'asc' }, { worker: 'asc' }] }, payments: true },
  });
  let invoices = 0, emails = 0;
  const company = org.shortName ?? org.name, online = acceptsOnline(org);
  for (let inv of open) {
    const balance = balanceCents(inv);
    if (balance <= 0) continue;
    const step = reminderStep(ymd(inv.dueDate), today, inv.remindersSent, inv.lastReminderAt ? localDate(inv.lastReminderAt, org.timezone) : null, localDate(inv.sentAt!, org.timezone));
    if (step === null) continue;
    // Claim the step first, so an overlapping run can't send the same reminder twice.
    const claimed = await tdb.invoice.updateMany({ where: { id: inv.id, remindersSent: inv.remindersSent }, data: { remindersSent: step + 1, lastReminderAt: now } });
    if (!claimed.count) continue;
    if (online && !inv.payToken) inv = { ...inv, payToken: await ensurePayToken(tdb, inv) };
    const to = [...new Set((inv.sentTo ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^\S+@\S+\.\S+$/.test(s)))];
    const pdf = to.length ? Buffer.from(await invoicePdf(org, inv)) : null;
    const daysFromDue = Math.round((Date.parse(`${today}T00:00:00Z`) - inv.dueDate.getTime()) / 864e5);
    let sent = 0;
    for (const addr of to) {
      const contact = inv.client.contacts.find((c) => c.email?.toLowerCase() === addr);
      const ap = inv.client.billingEmail?.toLowerCase() === addr;
      const greeting = contact ? contact.name.split(' ')[0] || 'there' : ap ? `${inv.client.name} Accounts Payable` : 'there';
      const { subject, text } = reminderEmail({ company, number: inv.number, client: inv.client.name, poNumber: inv.poNumber, balance, due: inv.dueDate, daysFromDue,
        payLink: online && inv.payToken ? payUrl(inv.payToken) : null, cardFeePct: Number(org.cardFeePct), remit: org.remitInstructions, greeting });
      const rel = contact ? { relatedType: 'contact', relatedId: contact.id } : { relatedType: 'client', relatedId: inv.client.id };
      if (contact?.emailOptOut) {
        await tdb.message.create({ data: { channel: 'email', toAddress: addr, subject, body: text, ...rel, status: 'blocked_opt_out' } as never });
        continue;
      }
      try {
        const r = await sendEmail({ to: addr, subject, text, fromName: company, replyTo: org.billingEmail ?? undefined, attachments: [{ filename: `${inv.number}.pdf`, content: pdf! }] });
        await tdb.message.create({ data: { channel: 'email', toAddress: addr, subject, body: text, ...rel, status: 'sent', providerId: r.id } as never });
        sent++;
      } catch (e) {
        await tdb.message.create({ data: { channel: 'email', toAddress: addr, subject, body: text, ...rel, status: 'failed', error: String((e as Error).message).slice(0, 300) } as never });
      }
    }
    invoices++; emails += sent;
    await logActivity(org.id, sent
      ? `Sent a payment reminder for ${inv.number} (${inv.client.name}, ${usd(balance)} ${daysFromDue > 0 ? `${daysFromDue} days past due` : daysFromDue === 0 ? 'due today' : 'due soon'}) to ${sent} recipient${sent === 1 ? '' : 's'}`
      : `Payment reminder for ${inv.number} (${inv.client.name}) wasn’t sent: no one to send it to, or they unsubscribed`);
  }
  return { invoices, emails };
}

export async function runInvoiceReminders(now = new Date()) {
  const orgs = await db.organization.findMany({ where: { invoiceReminders: true, subscriptionStatus: { in: ['trialing', 'active'] } } });
  let companies = 0, invoices = 0, emails = 0;
  for (const org of orgs) {
    if (!hasFeature(org, 'invoicing')) continue;
    const r = await remindOrg(org, now);
    companies++; invoices += r.invoices; emails += r.emails;
  }
  return { companies, invoices, emails };
}
