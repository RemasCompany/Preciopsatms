import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { payrollFacts, payrollSteps, progress, vmsFacts, vmsSteps, type PayrollFacts } from '@/lib/setup-checklist';

const RUN = `setup${Date.now()}`;
let org: string, other: string;
const base: PayrollFacts = { approvedTimesheets: 0, check: 'none', checkAvailable: true, exportProvider: null, workersOnAssignment: 0, workersWithoutPayrollId: 0, checkWorkers: 0, checkWorkersNotReady: 0, approvedRuns: 0, paidRuns: 0 };
const state = (steps: ReturnType<typeof payrollSteps>) => steps.map((s) => `${s.done ? '✓' : '·'} ${s.key}`);

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Setup Co', slug: `s-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `o-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.$disconnect();
});

describe('payroll setup steps', () => {
  it('starts with hours and the choice of how to pay', () => {
    const s = payrollSteps(base);
    expect(state(s)).toEqual(['· hours', '· provider', '· ids', '· run']);
    expect(progress(s)).toMatchObject({ done: 0, total: 4, next: { key: 'hours' } });
    expect(s[1].label).toBe('Choose how you pay workers');
    expect(payrollSteps({ ...base, checkAvailable: false })[1]).toMatchObject({ label: 'Choose your payroll provider', href: '#provider' });
  });

  it('follows the export path: IDs, then the first run', () => {
    const s = payrollSteps({ ...base, approvedTimesheets: 3, exportProvider: 'adp', workersOnAssignment: 4, workersWithoutPayrollId: 1 });
    expect(state(s)).toEqual(['✓ hours', '✓ provider', '· ids', '· run']);
    expect(s[2].hint).toBe('1 of 4 workers on assignment have none, so the import can’t match them. Add it on their candidate record.');
    expect(progress(payrollSteps({ ...base, approvedTimesheets: 3, exportProvider: 'adp', workersOnAssignment: 4, approvedRuns: 1 })).next).toBeNull();
  });

  it('follows the Check path: company, workers, first paid run', () => {
    expect(state(payrollSteps({ ...base, approvedTimesheets: 1, check: 'blocking' }))).toEqual(['✓ hours', '✓ provider', '· company', '· workers', '· run']);
    const s = payrollSteps({ ...base, approvedTimesheets: 1, check: 'completed', checkWorkers: 3, checkWorkersNotReady: 2, approvedRuns: 1 });
    expect(state(s)).toEqual(['✓ hours', '✓ provider', '✓ company', '· workers', '· run']);
    expect(s[3].hint).toBe('2 still to finish their SSN, W-4 and bank details. Send them their link from the run page.');
    // An approved run isn't done on this path until Check has paid it.
    expect(progress(payrollSteps({ ...base, approvedTimesheets: 1, check: 'needs_attention', checkWorkers: 3, paidRuns: 1 })).next).toBeNull();
  });
});

describe('VMS setup steps', () => {
  it('ticks off in order and flags placements without a work order', () => {
    const empty = { programs: 0, programJobs: 0, placements: 0, placementsWithoutWorkOrder: 0, timeSent: 0, remittances: 0 };
    expect(progress(vmsSteps(empty))).toMatchObject({ done: 0, total: 6, next: { key: 'program', href: '#add' } });
    const s = vmsSteps({ ...empty, programs: 1, programJobs: 2, placements: 3, placementsWithoutWorkOrder: 1 });
    expect(s.map((x) => x.done)).toEqual([true, true, true, false, false, false]);
    expect(s[3].hint).toBe('1 placement has none, so their time is left out of uploads.');
    expect(progress(vmsSteps({ programs: 1, programJobs: 2, placements: 3, placementsWithoutWorkOrder: 0, timeSent: 1, remittances: 1 })).next).toBeNull();
  });
});

describe('facts come from the firm’s own data only', () => {
  it('counts payroll and VMS facts per firm', async () => {
    const client = await db.client.create({ data: { organizationId: org, name: 'Harbor', paymentTerms: 'Net 30' } });
    const prog = await db.vmsProgram.create({ data: { organizationId: org, clientId: client.id, vms: 'beeline', name: 'Harbor Beeline' } });
    const job = await db.job.create({ data: { organizationId: org, clientId: client.id, title: 'Packer', vmsProgramId: prog.id, vmsReqId: 'R1', payRate: 18, billRate: 26 } });
    const [a, b] = await Promise.all(['Ana Ruiz', 'Ben Cole'].map((name, i) => db.candidate.create({ data: { organizationId: org, name, payrollId: i ? null : 'E1' } })));
    const ap = await db.application.create({ data: { organizationId: org, candidateId: a.id, jobId: job.id, stage: 'PLACED', vmsWorkOrderId: 'WO1' } });
    await db.application.create({ data: { organizationId: org, candidateId: b.id, jobId: job.id, stage: 'PLACED' } });
    await db.timesheet.create({ data: { organizationId: org, applicationId: ap.id, weekEnding: new Date('2026-10-11T00:00:00Z'), regularHours: 40, payRate: 18, billRate: 26, status: 'APPROVED', vmsExportedAt: new Date() } });
    await db.payrollConnection.create({ data: { organizationId: org, provider: 'check', companyId: `com_${RUN}`, workplaceId: 'wrk', onboardStatus: 'completed' } });

    const f = await payrollFacts(tenantDb(org), { payrollProvider: null }, true);
    expect(f).toMatchObject({ approvedTimesheets: 1, check: 'completed', workersOnAssignment: 2, workersWithoutPayrollId: 1, checkWorkers: 0, paidRuns: 0 });
    expect(await vmsFacts(tenantDb(org))).toEqual({ programs: 1, programJobs: 1, placements: 2, placementsWithoutWorkOrder: 1, timeSent: 1, remittances: 0 });
    expect(await vmsFacts(tenantDb(other))).toEqual({ programs: 0, programJobs: 0, placements: 0, placementsWithoutWorkOrder: 0, timeSent: 0, remittances: 0 });
    expect((await payrollFacts(tenantDb(other), { payrollProvider: 'adp' }, false))).toMatchObject({ approvedTimesheets: 0, check: 'none', workersOnAssignment: 0 });
  });
});
