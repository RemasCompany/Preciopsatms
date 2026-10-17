import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));

import { db } from '@/lib/db';
import { GET as LIST, POST as ADD } from '@/app/api/vms/programs/route';
import { PATCH as EDIT, DELETE as REMOVE } from '@/app/api/vms/programs/[id]/route';
import { POST as REQS } from '@/app/api/vms/programs/[id]/requisitions/route';
import { GET as PLACEMENTS, PATCH as SET_IDS } from '@/app/api/vms/programs/[id]/placements/route';
import { GET as TIME } from '@/app/api/vms/programs/[id]/time/route';
import { POST as REMIT } from '@/app/api/vms/programs/[id]/remittance/route';
import { detect, feeFor, parseDate, parseMoney, readRemittance, readRequisitions, timeFile, VMS } from '@/lib/vms';

const RUN = `vms${Date.now()}`;
let org: string, growth: string, other: string, admin: string, rec: string, gUser: string, oUser: string, client: string, otherClient: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object, url = 'http://x') => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });

const FG_REQS = [
  'Job Posting ID,Job Posting Title,Site,Start Date,End Date,Positions,Bill Rate,Status,Hiring Manager',
  'HPDJP00012,Forklift Operator,"Tampa, FL",11/02/2026,03/31/2027,3,$27.50,Open,Dana Ruiz',
  'HPDJP00013,Picker / Packer,"Tampa, FL",2026-11-09,,5,21,Approved,',
  ',Missing ID,Tampa,,,1,20,Open,',
  'HPDJP00014,Shift Lead,Tampa,13/45/2026,,1,abc,Open,',
].join('\n');

beforeAll(async () => {
  const mk = (n: string, plan: 'enterprise' | 'growth') => db.organization.create({ data: { name: n, slug: `${n}-${RUN}`, plan, subscriptionStatus: 'active' } }).then((o) => o.id);
  [org, growth, other] = await Promise.all([mk('acme', 'enterprise'), mk('grow', 'growth'), mk('other', 'enterprise')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, gUser, oUser] = await Promise.all([u('admin'), u('rec'), u('grow'), u('other')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: gUser, organizationId: growth, role: 'OWNER' }, { userId: oUser, organizationId: other, role: 'OWNER' }] });
  client = (await db.client.create({ data: { organizationId: org, name: 'Harbor Point', paymentTerms: 'Net 30' } })).id;
  otherClient = (await db.client.create({ data: { organizationId: other, name: 'Theirs', paymentTerms: 'Net 30' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('VMS files', () => {
  it('reads dates and amounts the way VMS exports write them', () => {
    expect(['11/02/2026', '3/9/26', '2026-03-09', '09-Mar-2026', '2/30/2026', 'soon', ''].map(parseDate)).toEqual(['2026-11-02', '2026-03-09', '2026-03-09', '2026-03-09', null, null, null]);
    expect(['$1,234.50', '(12.00)', '45', 'USD 10', 'abc', ''].map(parseMoney)).toEqual([1234.5, -12, 45, 10, null, null]);
  });

  it('finds columns by the preset’s names, or the program’s saved choice', () => {
    expect(detect(['Job Posting ID', 'Title'], { reqId: ['Job Posting ID'], title: ['Job Title', 'Title'] })).toEqual({ reqId: 'Job Posting ID', title: 'Title' });
    expect(detect(['Req #', 'Title'], { reqId: ['Job Posting ID'], title: ['Title'] }, { reqId: 'req #', title: '' })).toEqual({ reqId: 'Req #', title: null });
  });

  it('reads a Fieldglass requisition export and reports bad rows', () => {
    const r = readRequisitions(FG_REQS, 'fieldglass');
    expect(r.missing).toEqual([]);
    expect(r.rows[0]).toMatchObject({ line: 2, reqId: 'HPDJP00012', title: 'Forklift Operator', location: 'Tampa, FL', startDate: '2026-11-02', endDate: '2027-03-31', openings: 3, billRate: 27.5, status: 'OPEN', manager: 'Dana Ruiz', problems: [] });
    expect(r.rows[1]).toMatchObject({ startDate: '2026-11-09', billRate: 21, status: 'OPEN', problems: [] });
    expect(r.rows[2].problems).toEqual(['No requisition ID.']);
    expect(r.rows[3].problems).toEqual(['Start date “13/45/2026” isn’t a date.', 'Bill rate “abc” isn’t an amount.']);
    expect(readRequisitions('Something,Else\n1,2', 'beeline').missing).toEqual(['Requisition ID', 'Job title']);
  });

  it('writes approved time in each VMS’s upload layout, overtime at 1.5×', () => {
    const rows = [
      { timesheetId: 't1', reqId: 'R1', workOrderId: 'HPDWO001', workerId: 'W9', worker: 'Maria Lopez', weekEnding: '2026-11-08', regularHours: 40, overtimeHours: 2.5, billRate: 27.5 },
      { timesheetId: 't2', reqId: 'R1', workOrderId: null, workerId: null, worker: 'Tom Nguyen', weekEnding: '2026-11-08', regularHours: 32, overtimeHours: 0, billRate: 27.5 },
    ];
    const fg = timeFile(rows, 'fieldglass');
    expect(fg.csv.split('\r\n')).toEqual([
      'Work Order ID,Worker ID,Worker Name,Time Sheet Start Date,Time Sheet End Date,Rate Category,Units,Rate,Amount',
      'HPDWO001,W9,Maria Lopez,11/02/2026,11/08/2026,ST/Hr,40.00,27.50,1100.00',
      'HPDWO001,W9,Maria Lopez,11/02/2026,11/08/2026,OT/Hr,2.50,41.25,103.13',
      '',
    ]);
    expect(fg).toMatchObject({ rows: 2, hours: 42.5, amount: 120313, left: ['Tom Nguyen (week ending 2026-11-08): add the Work Order ID on their placement.'] });
    expect(timeFile(rows.slice(0, 1), 'beeline').csv.split('\r\n')[1]).toBe('HPDWO001,W9,Maria Lopez,11/08/2026,REG,40.00,27.50,1100.00');
    const vn = timeFile(rows.slice(0, 1), 'vndly', { headers: { workOrderId: 'WO Number' }, rateCodes: { overtime: 'OT1.5' } }).csv.split('\r\n');
    expect(vn[0]).toBe('WO Number,Worker ID,Worker Name,Start Date,End Date,Time Type,Hours,Bill Rate,Amount');
    expect(vn[2]).toContain(',OT1.5,2.50,41.25,103.13');
    expect(Object.keys(VMS)).toEqual(['fieldglass', 'beeline', 'vndly', 'other']);
  });

  it('reads remittances and works out the VMS fee', () => {
    const r = readRemittance('Invoice Number,Amount Paid,Payment Date,Payment ID,MSP Fee\nINV-0001,"$975.00",10/30/2026,P-77,25\n,10,,,\n', 'beeline');
    expect(r.rows[0]).toMatchObject({ invoice: 'INV-0001', amount: 975, paidOn: '2026-10-30', reference: 'P-77', fee: 25, problems: [] });
    expect(r.rows[1].problems).toEqual(['No invoice number.']);
    expect(feeFor(100000, 97500, 2500, 0)).toBe(2500); // the file says
    expect(feeFor(100000, 97500, null, 2.5)).toBe(2500); // shortfall is the program fee
    expect(feeFor(100000, 90000, null, 2.5)).toBe(0); // a real short payment stays open
    expect(feeFor(100000, 100000, null, 2.5)).toBe(0);
    expect(feeFor(100001, 97501, null, 2.5)).toBe(2500); // rounding
  });
});

describe('VMS programs', () => {
  let prog: string, forklift: string;

  it('are Enterprise, admin-managed and per firm', async () => {
    as(gUser, growth);
    expect((await LIST()).status).toBe(402);
    as(rec);
    expect((await ADD(req('POST', { clientId: client, vms: 'fieldglass', name: 'HP Fieldglass' }))).status).toBe(403);
    as(admin);
    expect((await (await ADD(req('POST', { clientId: client, vms: 'fieldglass', name: 'HP Fieldglass', feePct: 25 }))).json()).error).toBe('VMS fees are usually 1–5%. Enter a percent up to 20.');
    expect((await (await ADD(req('POST', { clientId: otherClient, vms: 'fieldglass', name: 'Theirs' }))).json()).error).toBe('That client was deleted.');
    const r = await ADD(req('POST', { clientId: client, vms: 'fieldglass', name: 'HP Fieldglass', supplierCode: 'SUP-123', feePct: 2.5 }));
    expect(r.status).toBe(201);
    prog = (await r.json()).id;
    expect((await (await LIST()).json()).programs[0]).toMatchObject({ name: 'HP Fieldglass', vmsLabel: 'SAP Fieldglass', idLabel: 'Work Order ID', clientName: 'Harbor Point', feePct: 2.5, rateCodes: { regular: 'ST/Hr', overtime: 'OT/Hr' } });
    as(oUser, other);
    expect((await (await LIST()).json()).programs).toEqual([]);
    expect((await EDIT(req('PATCH', { name: 'x' }), p(prog))).status).toBe(404);
    expect((await REQS(req('POST', { text: FG_REQS }), p(prog))).status).toBe(404);
  });

  it('previews, then imports requisitions as unpublished jobs; importing again only updates changes', async () => {
    as(admin);
    const plan = await (await REQS(req('POST', { text: FG_REQS }), p(prog))).json();
    expect(plan.counts).toEqual({ new: 2, update: 0, same: 0, skip: 2 });
    expect(await db.job.count({ where: { organizationId: org } })).toBe(0);
    expect(await (await REQS(req('POST', { text: FG_REQS, commit: true }), p(prog))).json()).toEqual({ ok: true, new: 2, update: 0, same: 0, skip: 2 });
    const job = await db.job.findFirst({ where: { organizationId: org, vmsReqId: 'HPDJP00012' } });
    expect(job).toMatchObject({ clientId: client, vmsProgramId: prog, title: 'Forklift Operator', openings: 3, publish: false, status: 'OPEN', location: 'Tampa, FL' });
    expect(Number(job!.billRate)).toBe(27.5);
    expect(job!.description).toBe('Hiring manager: Dana Ruiz\nRequested end date: 2027-03-31');
    forklift = job!.id;
    const again = await (await REQS(req('POST', { text: FG_REQS.replace('3,$27.50,Open', '4,$28.00,Filled') }), p(prog))).json();
    expect(again.counts).toEqual({ new: 0, update: 1, same: 1, skip: 2 });
    expect(again.rows[0].changes).toEqual(['positions', 'bill rate', 'status']);
    await REQS(req('POST', { text: FG_REQS.replace('3,$27.50,Open', '4,$28.00,Filled'), commit: true }), p(prog));
    expect(await db.job.findUnique({ where: { id: forklift } })).toMatchObject({ openings: 4, status: 'FILLED' });
    expect(await db.job.count({ where: { organizationId: org } })).toBe(2);
    await db.job.updateMany({ where: { id: forklift }, data: { status: 'OPEN' } });
  });

  it('saves a column choice for files with other headers', async () => {
    as(admin);
    const text = 'Req #,Role,Rate\nX-1,Welder,30\n';
    const plan = await (await REQS(req('POST', { text }), p(prog))).json();
    expect(plan.missing).toEqual(['Requisition ID', 'Job title']);
    expect((await (await REQS(req('POST', { text, commit: true }), p(prog))).json()).error).toBe('Choose the column for: Requisition ID, Job title.');
    const mapping = { reqId: 'Req #', title: 'Role', billRate: 'Rate' };
    expect((await (await REQS(req('POST', { text, mapping, commit: true }), p(prog))).json()).new).toBe(1);
    // Saved: the next file with the same headers matches without choosing again.
    expect((await (await REQS(req('POST', { text: 'Req #,Role,Rate\nX-2,Fitter,25\n' }), p(prog))).json()).counts.new).toBe(1);
  });

  it('keeps work order IDs on placements and sends approved time in the upload layout', async () => {
    const maria = await db.candidate.create({ data: { organizationId: org, name: 'Maria Lopez' } });
    const tom = await db.candidate.create({ data: { organizationId: org, name: 'Tom Nguyen' } });
    const am = await db.application.create({ data: { organizationId: org, candidateId: maria.id, jobId: forklift, stage: 'PLACED' } });
    const at = await db.application.create({ data: { organizationId: org, candidateId: tom.id, jobId: forklift, stage: 'PLACED' } });
    const week = new Date('2026-11-08T00:00:00Z');
    await db.timesheet.createMany({ data: [
      { organizationId: org, applicationId: am.id, weekEnding: week, regularHours: 40, overtimeHours: 2.5, payRate: 19, billRate: 27.5, status: 'APPROVED' },
      { organizationId: org, applicationId: at.id, weekEnding: week, regularHours: 32, overtimeHours: 0, payRate: 19, billRate: 27.5, status: 'APPROVED' },
    ] });
    as(rec);
    expect((await (await PLACEMENTS(req('GET'), p(prog))).json()).placements.map((x: { worker: string }) => x.worker).sort()).toEqual(['Maria Lopez', 'Tom Nguyen']);
    expect((await SET_IDS(req('PATCH', { applicationId: am.id, workOrderId: 'HPDWO001', workerId: 'W9' }), p(prog))).status).toBe(200);
    expect((await (await SET_IDS(req('PATCH', { applicationId: at.id, workOrderId: 'HPDWO001' }), p(prog))).json()).error).toBe('Another placement in this program already has HPDWO001.');
    expect((await (await SET_IDS(req('PATCH', { applicationId: at.id, workOrderId: 'bad id;' }), p(prog))).json()).error).toBe('IDs use letters, numbers, dots, dashes and slashes.');
    expect((await (await TIME(req('GET', undefined, 'http://x?week=2026-11-07'), p(prog))).json()).error).toBe('Choose a week-ending Sunday.');
    const list = await (await TIME(req('GET', undefined, 'http://x?week=2026-11-08'), p(prog))).json();
    expect(list.rows).toHaveLength(2);
    const file = await TIME(req('GET', undefined, 'http://x?week=2026-11-08&download=1'), p(prog));
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="hp-fieldglass-time-2026-11-08.csv"');
    expect(file.headers.get('x-left-out')).toBe('1');
    expect((await file.text()).split('\r\n').slice(1, 3)).toEqual(['HPDWO001,W9,Maria Lopez,11/02/2026,11/08/2026,ST/Hr,40.00,27.50,1100.00', 'HPDWO001,W9,Maria Lopez,11/02/2026,11/08/2026,OT/Hr,2.50,41.25,103.13']);
    // Sent once: the next file leaves it out unless asked; Tom goes out once he has an ID.
    await SET_IDS(req('PATCH', { applicationId: at.id, workOrderId: 'HPDWO002' }), p(prog));
    const next = await (await TIME(req('GET', undefined, 'http://x?week=2026-11-08&download=1'), p(prog))).text();
    expect(next.split('\r\n').filter(Boolean).slice(1)).toEqual(['HPDWO002,,Tom Nguyen,11/02/2026,11/08/2026,ST/Hr,32.00,27.50,880.00']);
    expect((await (await TIME(req('GET', undefined, 'http://x?week=2026-11-08&download=1&all=1'), p(prog))).text()).split('\r\n').filter(Boolean)).toHaveLength(4);
    as(oUser, other);
    expect((await TIME(req('GET', undefined, 'http://x?week=2026-11-08'), p(prog))).status).toBe(404);
    expect((await SET_IDS(req('PATCH', { applicationId: am.id, workOrderId: 'X' }), p(prog))).status).toBe(404);
  });

  it('matches remittances to invoices and closes ones short-paid by the VMS fee', async () => {
    const inv = (number: string, total: number) => db.invoice.create({ data: { organizationId: org, clientId: client, number, status: 'SENT', issueDate: new Date('2026-10-01'), dueDate: new Date('2026-10-31'), periodStart: new Date('2026-09-21'), periodEnd: new Date('2026-09-27'), terms: 'Net 30', total, subtotal: total } });
    const [a, b] = await Promise.all([inv('INV-0101', 1000), inv('INV-0102', 2000)]);
    await db.invoice.create({ data: { organizationId: other, clientId: otherClient, number: 'INV-0103', status: 'SENT', issueDate: new Date('2026-10-01'), dueDate: new Date('2026-10-31'), periodStart: new Date('2026-09-21'), periodEnd: new Date('2026-09-27'), terms: 'Net 30', total: 500, subtotal: 500 } });
    const text = 'Invoice ID,Amount Paid,Payment Date,Payment ID\ninv-0101,975.00,10/30/2026,FG-1\nINV-0102,1500.00,10/30/2026,FG-1\nINV-0103,500,10/30/2026,FG-1\nINV-0101,975.00,10/30/2026,FG-1\n';
    as(rec);
    expect((await REMIT(req('POST', { text }), p(prog))).status).toBe(403);
    as(admin);
    const plan = await (await REMIT(req('POST', { text }), p(prog))).json();
    expect(plan.rows.map((r: { action: string; feeCents: number }) => [r.action, r.feeCents])).toEqual([['pay', 2500], ['pay', 0], ['not_found', 0], ['paid', 0]]);
    expect(plan).toMatchObject({ totalCents: 247500, feeCents: 2500 });
    expect(await (await REMIT(req('POST', { text, commit: true }), p(prog))).json()).toMatchObject({ ok: true, recorded: 2 });
    expect(await db.invoice.findUnique({ where: { id: a.id } })).toMatchObject({ status: 'PAID' });
    expect(await db.invoice.findUnique({ where: { id: b.id } })).toMatchObject({ status: 'PARTIAL' });
    expect((await db.payment.findMany({ where: { invoiceId: a.id }, orderBy: { amount: 'desc' } })).map((x) => [Number(x.amount), x.method, x.reference])).toEqual([[975, 'ach', 'FG-1'], [25, 'vms_fee', 'FG-1']]);
    // The same file again records nothing.
    expect((await (await REMIT(req('POST', { text, commit: true }), p(prog))).json()).recorded).toBe(0);
    expect(await db.payment.count({ where: { invoiceId: b.id } })).toBe(1);
  });

  it('keeps the jobs when a program is removed', async () => {
    as(admin);
    expect((await REMOVE(req('DELETE'), p(prog))).status).toBe(200);
    expect(await db.job.findUnique({ where: { id: forklift } })).toMatchObject({ vmsProgramId: null, vmsReqId: 'HPDJP00012' });
    expect(await db.auditLog.count({ where: { organizationId: org, action: { startsWith: 'vms.' } } })).toBeGreaterThan(4);
  });
});
