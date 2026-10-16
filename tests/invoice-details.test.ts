import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof mail.sent)[number]) => { mail.sent.push(o); return { id: `em_${mail.sent.length}` }; }) }));

import { PDFDocument } from 'pdf-lib';
import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { invoiceTotals, itemCents } from '@/lib/invoicing';
import { invoicePdf, loadInvoice } from '@/lib/invoicing-server';
import { splitLines } from '@/lib/accounting';
import { portalData } from '@/lib/portal-server';
import { isPrivateAddress } from '@/lib/logo-fetch';
import { POST as CREATE } from '@/app/api/invoices/route';
import { GET as PREVIEW } from '@/app/api/invoices/preview/route';
import { PATCH as EDIT } from '@/app/api/invoices/[id]/route';
import { POST as SEND } from '@/app/api/invoices/[id]/send/route';

describe('invoice totals', () => {
  it('adds items, takes off discounts and taxes the subtotal, in cents', () => {
    expect(itemCents('expense', 3, 45)).toBe(13500);
    expect(itemCents('discount', 1, 100)).toBe(-10000);
    expect(invoiceTotals(150000, [13500, 2500, -10000], 6.5)).toEqual({ labor: 150000, extras: 16000, discounts: 10000, subtotal: 156000, tax: 10140, total: 166140 });
    expect(invoiceTotals(100, [], 0).tax).toBe(0);
  });
  it('never fetches a logo from a private address', () => {
    expect(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1'].every(isPrivateAddress)).toBe(true);
    expect(['8.8.8.8', '172.32.0.1', '2606:4700::1'].some(isPrivateAddress)).toBe(false);
  });
});

const RUN = `ind${Date.now()}`;
let org: string, admin: string, client: string, contact: string, app: string, wk1: string;
const W1 = '2026-09-13', W2 = '2026-09-20';
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-30T15:00:00Z') });
afterAll(() => { vi.useRealTimers(); });
const req = (method: string, body?: object, url = 'http://x') => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
const P = (id: string) => ({ params: { id } });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Detail Staffing LLC', slug: `ind-${RUN}`, plan: 'growth', subscriptionStatus: 'active',
    billingAddress: '100 Main St\nMiami, FL 33131', billingEmail: 'billing@detail.test', remitInstructions: 'ACH: First Bank, routing 000000000', taxId: '12-3456789' } })).id;
  admin = (await db.user.create({ data: { email: `admin@${RUN}.test`, name: 'Ada Admin', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: admin, organizationId: org, role: 'ADMIN' } });
  client = (await db.client.create({ data: { organizationId: org, name: 'Harbor Point', paymentTerms: 'Net 30', billingAddress: '200 Harbor Blvd\nTampa, FL 33602', billingEmail: 'ap@harbor.test', poNumber: 'PO-1', taxRatePct: 0 } })).id;
  contact = (await db.contact.create({ data: { organizationId: org, clientId: client, name: 'Rita Alvarez', email: 'rita@harbor.test' } })).id;
  const job = await db.job.create({ data: { organizationId: org, clientId: client, title: 'Forklift Operator', type: 'TEMP', payRate: 20, billRate: 30 } });
  const cand = await db.candidate.create({ data: { organizationId: org, name: 'Ana Diaz' } });
  app = (await db.application.create({ data: { organizationId: org, candidateId: cand.id, jobId: job.id, stage: 'PLACED' } })).id;
  const ts = (week: string, reg: number, ot: number, approved = false) => db.timesheet.create({ data: { organizationId: org, applicationId: app, weekEnding: new Date(`${week}T00:00:00Z`), regularHours: reg, overtimeHours: ot, payRate: 20, billRate: 30, status: 'APPROVED',
    ...(approved ? { clientApprovedAt: new Date('2026-09-22T12:00:00Z'), clientApprovedBy: 'Rita Alvarez' } : {}) } }).then((t) => t.id);
  wk1 = await ts(W1, 40, 0); await ts(W2, 40, 4, true);
  session.current = { user: { id: admin, orgId: org } };
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

let invId: string;
describe('making a detailed invoice', () => {
  it('previews the hours, client sign-offs and billing defaults', async () => {
    const r = await PREVIEW(req('GET', undefined, `http://x?clientId=${client}&from=${W1}&to=${W2}`));
    const p = await r.json();
    expect(p.defaults).toEqual({ poNumber: 'PO-1', billToName: '', billToAddress: '200 Harbor Blvd\nTampa, FL 33602', taxRatePct: 0 });
    expect(p.lines.map((l: { weekEnding: string; amount: number; approvedBy: string | null }) => [l.weekEnding, l.amount, l.approvedBy])).toEqual([[W1, 1200, null], [W2, 1380, 'Approved by Rita Alvarez Sep 22']]);
  });

  it('rejects bad items with a clear message', async () => {
    const bad = await CREATE(req('POST', { clientId: client, from: W1, to: W2, items: [{ kind: 'fee', description: 'Rush', quantity: 1, rate: -5 }] }));
    expect([bad.status, (await bad.json()).error]).toEqual([400, 'Enter item amounts as positive numbers; choose “Discount or credit” to take money off.']);
    const tooMuch = await CREATE(req('POST', { clientId: client, from: W1, to: W2, items: [{ kind: 'discount', description: 'Credit', quantity: 1, rate: 5000 }] }));
    expect([tooMuch.status, (await tooMuch.json()).error]).toEqual([400, 'The discounts ($5,000.00) are more than the invoice ($2,580.00).']);
  });

  it('creates a draft with PO, attention, items and tax, leaving out an unchecked week', async () => {
    const r = await CREATE(req('POST', { clientId: client, from: W1, to: W2, excludeTimesheetIds: [wk1], poNumber: 'PO-77', billToName: 'Rita Alvarez', billToAddress: '200 Harbor Blvd\nTampa, FL 33602', taxRatePct: 6.5, notes: 'Thanks!', saveDefaults: true,
      items: [{ kind: 'expense', description: 'Background check', quantity: 2, rate: 45 }, { kind: 'discount', description: 'Volume discount', quantity: 1, rate: 50 }] }));
    expect(r.status).toBe(201);
    invId = (await r.json()).id;
    const inv = await loadInvoice(tenantDb(org), invId);
    // 1380 labor + 90 − 50 = 1420 subtotal, 6.5% tax = 92.30, total 1512.30
    expect([Number(inv.subtotal), Number(inv.taxAmount), Number(inv.total), inv.poNumber, inv.billToName, inv.status]).toEqual([1420, 92.3, 1512.3, 'PO-77', 'Rita Alvarez', 'DRAFT']);
    expect(inv.lines.map((l) => [l.kind, Number(l.amount)])).toEqual([['hours', 1380], ['expense', 90], ['discount', -50]]);
    expect(inv.lines[0].approvedBy).toBe('Approved by Rita Alvarez Sep 22');
    // QuickBooks/Xero lines (with tax as its own line) add up to the total
    expect(splitLines(inv).reduce((s, l) => s + l.cents, 0)).toBe(151230);
    // The client keeps these as defaults; the unchecked week is still billable
    expect(await db.client.findUniqueOrThrow({ where: { id: client } })).toMatchObject({ poNumber: 'PO-77', billingContactId: contact });
    expect(Number((await db.client.findUniqueOrThrow({ where: { id: client } })).taxRatePct)).toBe(6.5);
    const again = await (await PREVIEW(req('GET', undefined, `http://x?clientId=${client}&from=${W1}&to=${W2}`))).json();
    expect(again.lines.map((l: { timesheetId: string }) => l.timesheetId)).toEqual([wk1]);
  });

  it('draws a PDF with every detail', async () => {
    const inv = await loadInvoice(tenantDb(org), invId);
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    const bytes = await invoicePdf(o, inv);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('a draft can be edited and stays hidden from the client portal until it’s sent', async () => {
    const e = await EDIT(req('PATCH', { action: 'details', taxRatePct: 0, items: [{ kind: 'fee', description: 'Rush order fee', quantity: 1, rate: 100 }], poNumber: 'PO-78' }), P(invId));
    expect(e.status).toBe(200);
    const inv = await loadInvoice(tenantDb(org), invId);
    expect([Number(inv.total), Number(inv.taxAmount), inv.poNumber, inv.lines.length]).toEqual([1480, 0, 'PO-78', 2]);
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    const portal = { org: o, tdb: tenantDb(org), contact: { id: contact, name: 'Rita Alvarez', email: 'rita@harbor.test' }, client: { id: client, name: 'Harbor Point', paymentTerms: 'Net 30' } };
    expect((await portalData(portal)).invoices).toEqual([]);

    mail.sent = [];
    const s = await SEND(req('POST', { contactIds: [contact], billingEmail: true }), P(invId));
    expect(s.status).toBe(200);
    expect(mail.sent.map((m) => m.to)).toEqual(['rita@harbor.test', 'ap@harbor.test']);
    expect(mail.sent[0].subject).toBe('Invoice ' + inv.number + ' from Detail Staffing LLC (PO PO-78) — $1,480.00 due Oct 30, 2026');
    expect(mail.sent[1].text).toContain('Hi Harbor Point Accounts Payable,');
    expect(mail.sent[0].text).toContain('Services: 1 worker, 40.00 regular and 4.00 overtime hours');
    expect(mail.sent[0].text).toContain('How to pay:\nACH: First Bank, routing 000000000');
    expect((await portalData(portal)).invoices.map((i: { id: string }) => i.id)).toEqual([invId]);

    const locked = await EDIT(req('PATCH', { action: 'details', poNumber: 'PO-79' }), P(invId));
    expect([locked.status, (await locked.json()).error]).toEqual([409, 'This invoice was already emailed to the client, so it can’t be changed. Void it and make a new one.']);
  });
});
