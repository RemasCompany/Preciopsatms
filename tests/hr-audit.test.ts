import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { CHECKLIST, auditCsv, checklistFor, i9RetainUntil, score, type Finding } from '@/lib/hr-audit';
import { GET as LIST, POST as START } from '@/app/api/hr-audits/route';
import { GET as ONE, PATCH } from '@/app/api/hr-audits/[id]/route';
import { POST as COMPLETE } from '@/app/api/hr-audits/[id]/complete/route';
import { POST as TASK } from '@/app/api/hr-audits/[id]/task/route';
import { GET as EXPORT } from '@/app/api/hr-audits/[id]/export/route';

const RUN = `hra${Date.now()}`;
let org: string, other: string, small: string, admin: string, rec: string, outsider: string, smallAdmin: string;
const as = (id: string, o = org) => { session.current = { user: { id, orgId: o } }; };
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const p = (id: string) => ({ params: { id } });
const req = (method: string, body?: unknown) => new Request('http://x', { method, body: body === undefined ? undefined : JSON.stringify(body) });
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ymd = (x: Date) => x.toISOString().slice(0, 10);
const ago = (days: number) => ymd(new Date(Date.now() - days * 864e5));

describe('audit rules', () => {
  it('keeps former employees’ I-9s until the later of 3 years after hire or 1 year after leaving', () => {
    expect(i9RetainUntil('2020-03-01', '2021-01-15')).toBe('2023-03-01'); // short tenure: 3 years after hire
    expect(i9RetainUntil('2015-03-01', '2024-06-30')).toBe('2025-06-30'); // long tenure: 1 year after leaving
  });

  it('scores checks by severity, counts reviewed checks as handled, and leaves Not applicable out', () => {
    const f = (key: string, severity: Finding['severity'], n: number): Finding => ({ key, title: key, severity, why: '', fix: '', href: '', items: Array.from({ length: n }, (_, i) => ({ id: `${i}`, name: `P${i}`, detail: '' })) });
    const items = [{ key: 'a', text: 'A', why: '' }, { key: 'b', text: 'B', why: '' }];
    const findings = [f('h', 'high', 2), f('m', 'medium', 0), f('i', 'info', 5)];
    expect(score(findings, {}, {}, items)).toBe(22); // medium passes (2 of 9)
    expect(score(findings, { a: { answer: 'yes' }, b: { answer: 'na' } }, {}, items)).toBe(57); // 4 of 7
    expect(score(findings, { a: { answer: 'yes' }, b: { answer: 'na' } }, { h: { note: 'Paper I-9s checked', by: 'x', at: '' } }, items)).toBe(100);
    expect(checklistFor('EMPLOYER').length).toBe(CHECKLIST.length - 1); // client contracts are for agencies
  });

  it('exports a spreadsheet that can’t run formulas', () => {
    const csv = auditCsv({ title: 'Q4', status: 'OPEN', startedAt: '2026-10-01T00:00:00Z', completedAt: null, score: 50 },
      [{ key: 'k', title: 'Check', severity: 'high', why: '', fix: '', href: '', items: [{ id: '1', name: '=HYPERLINK("x")', detail: 'Started, late' }] }], { posters: { answer: 'no', note: 'Ordering' } }, {}, CHECKLIST.slice(0, 1));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Started, late"');
    expect(csv).toContain('Checklist,');
  });
});

describe('running an HR audit', () => {
  beforeAll(async () => {
    const mkOrg = (n: string, plan: 'growth' | 'starter', kind: 'EMPLOYER' | 'STAFFING' = 'EMPLOYER') => db.organization.create({ data: { name: `${n} Co`, slug: `${n}-${RUN}`, plan, kind, subscriptionStatus: 'active' } }).then((o) => o.id);
    org = await mkOrg('acme', 'growth'); other = await mkOrg('other', 'growth'); small = await mkOrg('small', 'starter');
    const mk = async (who: string, o: string, role: 'OWNER' | 'ADMIN' | 'RECRUITER', twoStep = false) => { const u = await db.user.create({ data: { email: `${who}@${RUN}.test`, name: who, passwordHash: 'x', totpEnabledAt: twoStep ? new Date() : null } }); await db.membership.create({ data: { userId: u.id, organizationId: o, role } }); return u.id; };
    admin = await mk('admin', org, 'ADMIN'); rec = await mk('rec', org, 'RECRUITER', true); outsider = await mk('out', other, 'ADMIN', true); smallAdmin = await mk('smalladmin', small, 'ADMIN');
    // Employees with the problems the audit should find.
    const emp = async (name: string, data: Record<string, unknown>) => {
      const c = await db.candidate.create({ data: { organizationId: org, name } });
      await db.employee.create({ data: { organizationId: org, candidateId: c.id, title: 'Associate', startDate: d(ago(30)), payType: 'HOURLY', payRate: 18, emergencyPhone: '5125550100', ...data } as never });
      return c.id;
    };
    const lowPay = await emp('Lena Low', { payRate: 6.5 });
    await emp('Sal Under', { payType: 'SALARY', payRate: 30000 });
    await emp('Nora NoContact', { emergencyPhone: null });
    const done = await emp('Dana Done', {});
    await emp('Fred Former', { status: 'TERMINATED', startDate: d('2018-01-08'), endDate: d('2022-05-01') });
    // Dana has her I-9 and W-4 done in onboarding; nobody else does.
    const job = await db.job.create({ data: { organizationId: org, title: 'Associate', type: 'DIRECT_HIRE' } as never });
    const app = await db.application.create({ data: { organizationId: org, candidateId: done, jobId: job.id, stage: 'PLACED' } as never });
    const ob = await db.onboarding.create({ data: { organizationId: org, applicationId: app.id, candidateId: done, packageName: 'New hire', status: 'COMPLETE' } as never });
    await db.onboardingStep.createMany({ data: [
      { organizationId: org, onboardingId: ob.id, position: 0, kind: 'STAFF', label: 'I-9', config: { task: 'i9' }, status: 'DONE' },
      { organizationId: org, onboardingId: ob.id, position: 1, kind: 'STAFF', label: 'W-4', config: { task: 'w4' }, status: 'DONE' },
    ] });
    await db.credential.create({ data: { organizationId: org, candidateId: lowPay, type: 'CPR', expiresAt: d(ago(10)) } });
    await db.candidate.create({ data: { organizationId: other, name: 'Other Person' } });
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
    await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
    await db.$disconnect();
  });

  it('is for admins on Growth and above', async () => {
    as(rec);
    expect((await LIST()).status).toBe(403);
    as(smallAdmin, small);
    expect((await LIST()).status).toBe(402);
  });

  it('finds the gaps in the company’s own records', async () => {
    as(admin);
    const s = await json(await START(req('POST', {})));
    expect(s.status).toBe(201);
    expect((await json(await START(req('POST', {})))).body.error).toMatch(/already open/);
    const a = (await json(await ONE(req('GET'), p(s.body.id)))).body;
    const by = (k: string) => a.findings.find((f: Finding) => f.key === k) as Finding | undefined;
    const names = (k: string) => by(k)!.items.map((i) => i.name);
    expect(names('i9_missing')).toEqual(['Lena Low', 'Nora NoContact', 'Sal Under']); // Dana's is done
    expect(names('w4_missing')).toEqual(['Lena Low', 'Nora NoContact', 'Sal Under']);
    expect(names('pay_below_minimum')).toEqual(['Lena Low']);
    expect(by('exempt_below_threshold')!.items[0]).toMatchObject({ name: 'Sal Under', detail: '$30,000.00/year ($576.92/week).' });
    expect(names('emergency_contact_missing')).toEqual(['Nora NoContact']);
    expect(names('credentials_expired')).toEqual(['Lena Low']);
    expect(names('i9_destroy')).toEqual(['Fred Former']);
    expect(names('admin_no_two_step')).toEqual(['admin']); // the recruiter has two-step, and isn't an admin anyway
    expect(by('everify_overdue')).toBeDefined();
    expect(by('aca_offer_due')!.items).toEqual([]);
    // Nothing from another company.
    expect(JSON.stringify(a.findings)).not.toContain('Other Person');
    expect(a.checklist.some((c: { key: string }) => c.key === 'client_contracts')).toBe(false); // employer
  });

  it('updates as things are fixed, takes reviews with a note, and records the checklist', async () => {
    as(admin);
    const id = (await json(await LIST())).body.audits[0].id;
    await db.employee.updateMany({ where: { organizationId: org, candidate: { name: 'Lena Low' } }, data: { payRate: 15 } });
    let a = (await json(await ONE(req('GET'), p(id)))).body;
    expect(a.findings.find((f: Finding) => f.key === 'pay_below_minimum').items).toEqual([]);
    expect((await json(await PATCH(req('PATCH', { review: { key: 'i9_missing' } }), p(id)))).body.error).toMatch(/Say what you reviewed/);
    a = (await json(await PATCH(req('PATCH', { review: { key: 'i9_missing', note: 'Paper I-9s checked in the file room' } }), p(id)))).body;
    expect(a.reviews.i9_missing).toMatchObject({ note: 'Paper I-9s checked in the file room', by: 'admin' });
    a = (await json(await PATCH(req('PATCH', { answer: { key: 'posters', answer: 'no', note: 'Ordering the 2026 posters' } }), p(id)))).body;
    expect(a.answers.posters).toEqual({ answer: 'no', note: 'Ordering the 2026 posters' });
    expect((await json(await PATCH(req('PATCH', { answer: { key: 'made_up', answer: 'yes' } }), p(id)))).status).toBe(400);
    // A follow-up task (no names in the title).
    const t = await json(await TASK(req('POST', { key: 'w4_missing' }), p(id)));
    expect(t.status).toBe(201);
    expect(await db.task.findFirstOrThrow({ where: { id: t.body.id } })).toMatchObject({ title: 'HR audit: No W-4 on record (3)', assigneeId: admin, organizationId: org });
    // Another company's admin can't see or touch it.
    as(outsider, other);
    expect((await ONE(req('GET'), p(id))).status).toBe(404);
    expect((await PATCH(req('PATCH', { notes: 'x' }), p(id))).status).toBe(404);
  });

  it('completes only with every checklist item answered, then freezes', async () => {
    as(admin);
    const id = (await json(await LIST())).body.audits[0].id;
    expect((await json(await COMPLETE(req('POST'), p(id)))).body.error).toMatch(/Answer every checklist item first \(14 left\)/);
    for (const c of checklistFor('EMPLOYER')) if (c.key !== 'posters') await PATCH(req('PATCH', { answer: { key: c.key, answer: c.key === 'eeo1' ? 'na' : 'yes' } }), p(id));
    const done = (await json(await COMPLETE(req('POST'), p(id)))).body;
    expect(done.status).toBe('COMPLETED');
    expect(done.score).toBeGreaterThan(0);
    expect(done.score).toBeLessThan(100);
    // Frozen: later fixes don't change it, and it can't be edited.
    await db.employee.updateMany({ where: { organizationId: org }, data: { emergencyPhone: '5125550100' } });
    const again = (await json(await ONE(req('GET'), p(id)))).body;
    expect(again.findings.find((f: Finding) => f.key === 'emergency_contact_missing').items).toHaveLength(1);
    expect(again.score).toBe(done.score);
    expect((await json(await PATCH(req('PATCH', { notes: 'late edit' }), p(id)))).body.error).toMatch(/completed/);
    const csv = await EXPORT(req('GET'), p(id));
    expect(csv.headers.get('content-disposition')).toMatch(/attachment; filename="HR-audit/);
    expect(await csv.text()).toContain('Paper I-9s checked in the file room');
    expect(await db.auditLog.count({ where: { organizationId: org, action: { in: ['hr_audit.start', 'hr_audit.complete', 'hr_audit.export'] } } })).toBe(3);
    // A new one can start now.
    expect((await START(req('POST', { title: 'Spring check' }))).status).toBe(201);
  });
});
