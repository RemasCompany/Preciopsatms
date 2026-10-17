// Guided setup for payroll and VMS programs: each step is worked out from the firm's own data, so it ticks itself
// off as they go. The step lists are pure functions (tested and shared with the UI); the loaders below gather the facts.
import { hourlyWhere } from './schedule-server';
import type { TenantDb } from './tenant';

export type Step = { key: string; label: string; hint: string; done: boolean; href: string; action: string };

export type PayrollFacts = {
  approvedTimesheets: number; check: 'none' | 'blocking' | 'needs_attention' | 'completed'; checkAvailable: boolean; exportProvider: string | null;
  workersOnAssignment: number; workersWithoutPayrollId: number; checkWorkersNotReady: number; checkWorkers: number; approvedRuns: number; paidRuns: number;
};

/** Two paths: pay through Check, or export a file for another provider. Choosing is itself a step. */
export function payrollSteps(f: PayrollFacts): Step[] {
  const viaCheck = f.check !== 'none';
  const steps: Step[] = [
    { key: 'hours', label: 'Approve a week of hours', hint: 'Payroll runs are built from approved timesheets.', done: f.approvedTimesheets > 0, href: '/app/timesheets', action: 'Open timesheets' },
    {
      key: 'provider', label: f.checkAvailable ? 'Choose how you pay workers' : 'Choose your payroll provider',
      hint: f.checkAvailable ? 'Pay through Check here (taxes, direct deposit and filings), or export a file for ADP, Paychex, Gusto or QuickBooks.' : 'Exports come out in its import layout.',
      done: viaCheck || !!f.exportProvider, href: f.checkAvailable ? '#processing' : '#provider', action: 'Choose',
    },
  ];
  if (viaCheck) {
    steps.push(
      { key: 'company', label: 'Finish your company’s setup in Check', hint: 'Your EIN, bank account and state tax accounts, entered on Check’s own pages.', done: f.check !== 'blocking', href: '#processing', action: 'Open setup' },
      {
        key: 'workers', label: 'Workers set up their pay in Check',
        hint: !f.checkWorkers ? 'Workers are added to Check when you send your first run; then send each one their setup link from the run.' : f.checkWorkersNotReady ? `${f.checkWorkersNotReady} still to finish their SSN, W-4 and bank details. Send them their link from the run page.` : 'Everyone on Check has finished.',
        done: f.checkWorkers > 0 && f.checkWorkersNotReady === 0, href: '#runs', action: 'See runs',
      },
      { key: 'run', label: 'Send your first run to Check and approve it', hint: 'Check shows taxes and net pay before you approve, then pays on the pay date.', done: f.paidRuns > 0, href: '#start', action: 'Start a run' },
    );
  } else {
    steps.push(
      {
        key: 'ids', label: 'Add payroll employee IDs', hint: f.workersWithoutPayrollId ? `${f.workersWithoutPayrollId} of ${f.workersOnAssignment} workers on assignment have none, so the import can’t match them. Add it on their candidate record.` : 'Every worker on assignment has one.',
        done: f.workersOnAssignment > 0 && f.workersWithoutPayrollId === 0, href: '/app/candidates', action: 'Open candidates',
      },
      { key: 'run', label: 'Approve and export your first run', hint: 'Then mark it paid once your provider has paid it.', done: f.approvedRuns + f.paidRuns > 0, href: '#start', action: 'Start a run' },
    );
  }
  return steps;
}

export type VmsFacts = { programs: number; programJobs: number; placements: number; placementsWithoutWorkOrder: number; timeSent: number; remittances: number };

export function vmsSteps(f: VmsFacts): Step[] {
  return [
    { key: 'program', label: 'Add a program for each VMS client', hint: 'Choose the client and the VMS (Fieldglass, Beeline, VNDLY or other), with your supplier ID and the VMS fee.', done: f.programs > 0, href: '#add', action: 'Add a program' },
    { key: 'reqs', label: 'Import their requisitions', hint: 'Export open requisitions from the VMS as CSV. New ones become jobs; re-importing only updates changes.', done: f.programJobs > 0, href: '#tab-reqs', action: 'Import' },
    { key: 'place', label: 'Place workers on those jobs', hint: 'Move candidates to Placed in the pipeline once the VMS confirms them.', done: f.placements > 0, href: '/app/pipeline', action: 'Open pipeline' },
    {
      key: 'wo', label: 'Add each placement’s work order ID', hint: f.placementsWithoutWorkOrder ? `${f.placementsWithoutWorkOrder} placement${f.placementsWithoutWorkOrder === 1 ? ' has' : 's have'} none, so their time is left out of uploads.` : 'Time files match on it.',
      done: f.placements > 0 && f.placementsWithoutWorkOrder === 0, href: '#tab-placements', action: 'Add IDs',
    },
    { key: 'time', label: 'Send approved time', hint: 'Download the week’s time file and upload it in the VMS.', done: f.timeSent > 0, href: '#tab-time', action: 'Get time file' },
    { key: 'remit', label: 'Import a remittance', hint: 'Payments are matched to your invoices, with the VMS fee recorded so they close.', done: f.remittances > 0, href: '#tab-remit', action: 'Import' },
  ];
}

export const progress = (steps: Step[]) => ({ done: steps.filter((s) => s.done).length, total: steps.length, next: steps.find((s) => !s.done) ?? null });

export async function payrollFacts(tdb: TenantDb, org: { payrollProvider: string | null }, checkAvailable: boolean): Promise<PayrollFacts> {
  const [approvedTimesheets, conn, apps, checkWorkers, checkWorkersNotReady, approvedRuns, paidRuns] = await Promise.all([
    tdb.timesheet.count({ where: { status: { in: ['APPROVED', 'PAID'] } } }),
    tdb.payrollConnection.findFirst({ where: { provider: 'check' }, select: { onboardStatus: true } }),
    tdb.application.findMany({ where: hourlyWhere, select: { candidate: { select: { id: true, payrollId: true } } } }),
    tdb.payrollWorker.count({ where: { provider: 'check' } }),
    tdb.payrollWorker.count({ where: { provider: 'check', onboardStatus: 'blocking' } }),
    tdb.payrollRun.count({ where: { status: 'APPROVED' } }),
    tdb.payrollRun.count({ where: { status: 'PAID' } }),
  ]);
  const people = new Map(apps.map((a) => [a.candidate.id, a.candidate.payrollId]));
  return {
    approvedTimesheets, check: (conn?.onboardStatus as PayrollFacts['check']) ?? 'none', checkAvailable, exportProvider: org.payrollProvider,
    workersOnAssignment: people.size, workersWithoutPayrollId: [...people.values()].filter((v) => !v).length, checkWorkers, checkWorkersNotReady, approvedRuns, paidRuns,
  };
}

export async function vmsFacts(tdb: TenantDb): Promise<VmsFacts> {
  const program = { vmsProgramId: { not: null } };
  const [programs, programJobs, placements, placementsWithoutWorkOrder, timeSent, remittances] = await Promise.all([
    tdb.vmsProgram.count(),
    tdb.job.count({ where: program }),
    tdb.application.count({ where: { stage: 'PLACED', job: program } }),
    tdb.application.count({ where: { stage: 'PLACED', job: program, vmsWorkOrderId: null } }),
    tdb.timesheet.count({ where: { vmsExportedAt: { not: null } } }),
    tdb.payment.count({ where: { notes: { contains: 'remittance (' } } }),
  ]);
  return { programs, programJobs, placements, placementsWithoutWorkOrder, timeSent, remittances };
}
