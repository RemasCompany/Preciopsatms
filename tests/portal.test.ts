import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof mail.sent)[number]) => { mail.sent.push(o); return { id: 'e' }; }) }));

import { db } from '@/lib/db';
import { POST as STAFF } from '@/app/api/clients/portal/route';
import { GET as PORTAL, POST as ACT } from '@/app/api/portal/[token]/route';
import { GET as INVOICE_PDF } from '@/app/api/portal/[token]/invoices/[id]/route';
import { POST as LOGIN } from '@/app/api/portal/login/route';
import { PUT as HOURS } from '@/app/api/timesheets/route';

const RUN = `pt${Date.now()}`;
let org: string, rec: string, harbor: string, other: string, rita: string, otherContact: string, appA: string, appOther: string, tsA: string, tsOther: string, invOwn: string, invOther: string, token: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, headers: { 'x-forwarded-for': '5.5.5.5' }, body: body ? JSON.stringify(body) : undefined });
const T = (t = token) => ({ params: { token: t } });
const WEEK = '2026-09-20';
const linkIn = (text: string) => text.match(/\/client\/([\w-]{20,})/)![1];

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Portal Staffing', shortName: 'Portal', slug: `p-${RUN}`, plan: 'growth', subscriptionStatus: 'active', applyEmail: 'jobs@portal.test' } })).id;
  rec = (await db.user.create({ data: { email: `rec@${RUN}.test`, name: 'Rae Recruiter', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: rec, organizationId: org, role: 'RECRUITER' } });
  harbor = (await db.client.create({ data: { organizationId: org, name: 'Harbor Point' } })).id;
  other = (await db.client.create({ data: { organizationId: org, name: 'Other Client' } })).id;
  rita = (await db.contact.create({ data: { organizationId: org, clientId: harbor, name: 'Rita Alvarez', email: 'rita@harbor.test' } })).id;
  otherContact = (await db.contact.create({ data: { organizationId: org, clientId: other, name: 'Oscar Other', email: 'oscar@other.test' } })).id;
  const job = (clientId: string, title: string) => db.job.create({ data: { organizationId: org, clientId, title, type: 'TEMP', payRate: 19.25, billRate: 28.5 } }).then((j) => j.id);
  const [jA, jO] = await Promise.all([job(harbor, 'Forklift Operator'), job(other, 'Secret Other Job')]);
  const cand = (n: string) => db.candidate.create({ data: { organizationId: org, name: n, email: `${n.split(' ')[0].toLowerCase()}@w.test`, phone: '4075550000' } }).then((c) => c.id);
  appA = (await db.application.create({ data: { organizationId: org, candidateId: await cand('Ana Diaz'), jobId: jA, stage: 'PLACED' } })).id;
  appOther = (await db.application.create({ data: { organizationId: org, candidateId: await cand('Zed Hidden'), jobId: jO, stage: 'PLACED' } })).id;
  const ts = (applicationId: string) => db.timesheet.create({ data: { organizationId: org, applicationId, weekEnding: new Date(`${WEEK}T00:00:00Z`), regularHours: 40, overtimeHours: 2, payRate: 19.25, billRate: 28.5 } }).then((t) => t.id);
  [tsA, tsOther] = await Promise.all([ts(appA), ts(appOther)]);
  const inv = (clientId: string, number: string) => db.invoice.create({ data: { organizationId: org, clientId, number, issueDate: new Date(), dueDate: new Date(), periodStart: new Date(), periodEnd: new Date(), terms: 'Net 30', total: 1225.5, status: 'SENT' } }).then((i) => i.id);
  [invOwn, invOther] = await Promise.all([inv(harbor, 'INV-P-1'), inv(other, 'INV-P-2')]);
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('client portal access', () => {
  it('staff email a contact a private link', async () => {
    as(rec);
    mail.sent = [];
    expect((await STAFF(req('POST', { contactId: rita, action: 'send' }))).status).toBe(200);
    expect(mail.sent[0]).toMatchObject({ to: 'rita@harbor.test', subject: 'Your Portal client portal' });
    token = linkIn(mail.sent[0].text);
    expect(await db.message.count({ where: { organizationId: org, relatedId: rita } })).toBe(1);
    expect((await db.message.findFirst({ where: { organizationId: org, relatedId: rita } }))!.body).not.toContain(token);
  });

  it('shows only this client’s data, and never pay rates', async () => {
    const d = await (await PORTAL(req('GET'), T())).json();
    expect(d.client.name).toBe('Harbor Point');
    expect(d.workers.map((w: { name: string }) => w.name)).toEqual(['Ana Diaz']);
    expect(d.timesheets).toEqual([expect.objectContaining({ worker: 'Ana Diaz', reg: 40, ot: 2, billRate: 28.5, amount: 1225.5 })]);
    expect(d.invoices.map((i: { number: string }) => i.number)).toEqual(['INV-P-1']);
    const raw = JSON.stringify(d);
    for (const hidden of ['19.25', 'payRate', 'Zed Hidden', 'Secret Other Job', 'Other Client', '@w.test', '4075550000']) expect(raw).not.toContain(hidden);
  });

  it('approves its own hours only; changed hours need approval again', async () => {
    expect((await ACT(req('POST', { action: 'approve', timesheetIds: [tsA, tsOther] }), T())).status).toBe(404);
    expect((await ACT(req('POST', { action: 'approve', timesheetIds: [tsA] }), T())).status).toBe(200);
    expect(await db.timesheet.findUnique({ where: { id: tsA } })).toMatchObject({ clientApprovedBy: 'Rita Alvarez' });
    expect((await db.timesheet.findUnique({ where: { id: tsOther } }))!.clientApprovedAt).toBeNull();
    as(rec);
    await HOURS(req('PUT', { applicationId: appA, week: WEEK, regularHours: 38, overtimeHours: 2 }));
    expect((await db.timesheet.findUnique({ where: { id: tsA } }))!.clientApprovedAt).toBeNull();
  });

  it('questions hours (a task for the team), rates a worker, requests staff', async () => {
    expect((await (await ACT(req('POST', { action: 'dispute', timesheetId: tsA, note: 'no' }), T())).json()).error).toBe('Tell us what looks wrong.');
    expect((await ACT(req('POST', { action: 'dispute', timesheetId: tsA, note: 'Ana left at 3pm Tuesday' }), T())).status).toBe(200);
    expect(await db.task.count({ where: { organizationId: org, title: { contains: 'Ana left at 3pm Tuesday' }, priority: 'High' } })).toBe(1);
    expect((await ACT(req('POST', { action: 'rate', applicationId: appOther, rating: 5, wouldRehire: true }), T())).status).toBe(404);
    expect((await ACT(req('POST', { action: 'rate', applicationId: appA, rating: 4, wouldRehire: true, comment: 'Reliable' }), T())).status).toBe(200);
    expect(await db.feedback.findFirst({ where: { organizationId: org, applicationId: appA } })).toMatchObject({ source: 'CLIENT', rating: 4, authorName: 'Rita Alvarez', contactId: rita });
    expect((await (await ACT(req('POST', { action: 'requestJob', title: 'Packer', openings: 3, startDate: '2020-01-01' }), T())).json()).error).toBe('The start date is in the past.');
    const r = await (await ACT(req('POST', { action: 'requestJob', title: 'Packer', openings: 3, startDate: '2030-01-06', shift: '1st shift' }), T())).json();
    expect(await db.job.findUnique({ where: { id: r.jobId } })).toMatchObject({ clientId: harbor, status: 'ON_HOLD', publish: false, openings: 3 });
  });

  it('downloads its own invoices only', async () => {
    expect((await INVOICE_PDF(req('GET'), { params: { token, id: invOwn } })).headers.get('content-type')).toBe('application/pdf');
    expect((await INVOICE_PDF(req('GET'), { params: { token, id: invOther } })).status).toBe(404);
  });

  it('login sends a fresh link only to contacts who had access, with the same answer either way', async () => {
    mail.sent = [];
    const a = await (await LOGIN(req('POST', { slug: `p-${RUN}`, email: 'RITA@harbor.test' }))).json();
    const b = await (await LOGIN(req('POST', { slug: `p-${RUN}`, email: 'oscar@other.test' }))).json();
    expect(a).toEqual(b);
    expect(mail.sent.map((m) => m.to)).toEqual(['rita@harbor.test']);
  });

  it('stops working when revoked, expired, or off the plan', async () => {
    as(rec);
    await STAFF(req('POST', { contactId: otherContact, action: 'send' }));
    const oscar = linkIn(mail.sent.at(-1)!.text);
    await db.organization.update({ where: { id: org }, data: { plan: 'starter' } });
    expect((await PORTAL(req('GET'), T(oscar))).status).toBe(404);
    await db.organization.update({ where: { id: org }, data: { plan: 'growth' } });
    expect((await PORTAL(req('GET'), T(oscar))).status).toBe(200);
    await db.clientPortalLink.updateMany({ where: { contactId: otherContact }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await PORTAL(req('GET'), T(oscar))).status).toBe(404);
    expect((await STAFF(req('POST', { contactId: rita, action: 'revoke' }))).status).toBe(200);
    expect((await (await PORTAL(req('GET'), T())).json()).error).toBe('This link has expired or was turned off. Ask for a new one below.');
  });
});
