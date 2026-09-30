import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature, type Feature } from '@/lib/plans';
import { RecordsProvider } from '@/components/Records';
import AppNav, { type NavGroup } from '@/components/AppNav';
import ResponsiveTables from '@/components/ResponsiveTables';

const NAV: [string, [href: string, label: string, feature?: Feature][]][] = [
  ['Recruiting', [['/app', 'Dashboard'], ['/app/pipeline', 'Pipeline'], ['/app/jobs', 'Jobs'], ['/app/candidates', 'Candidates'], ['/app/onboarding', 'Onboarding', 'onboarding'], ['/app/credentials', 'Credentials', 'credentials'], ['/app/schedule', 'Schedule', 'scheduling'], ['/app/timeclock', 'Time clock', 'timeclock'], ['/app/timesheets', 'Timesheets & payroll', 'timesheets'], ['/app/payroll', 'Payroll runs', 'payrollRuns']]],
  ['Sales', [['/app/leads', 'Lead generation', 'leads'], ['/app/clients', 'Clients & contacts', 'crm'], ['/app/deals', 'Deals', 'crm'], ['/app/sales', 'Sales metrics', 'crm']]],
  ['Operations', [['/app/vendors', 'Vendors', 'vendors'], ['/app/documents', 'E-signatures', 'esign'], ['/app/eeo', 'EEO reporting', 'eeo'], ['/app/tasks', 'Tasks'], ['/app/team', 'Team'], ['/app/settings', 'Settings & data'], ['/app/billing', 'Billing']]],
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const { org } = ctx;
  const trialDays = org.trialEndsAt ? Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 864e5) : 0;
  return (
    <div className="shell">
      <AppNav company={org.shortName ?? org.name} groups={NAV.map(([g, items]) => [g, items.filter(([, , f]) => !f || hasFeature(org, f)).map(([h, l]) => [h, l])] as NavGroup).filter(([, items]) => items.length)} />
      <div className="main">
        {org.subscriptionStatus === 'trialing' && trialDays > 0 && <p className="card banner">{trialDays} days left in your trial. <Link href="/app/billing">Choose a plan</Link></p>}
        {!['trialing', 'active'].includes(org.subscriptionStatus) && <p className="card banner error">Your subscription is {org.subscriptionStatus.replace('_', ' ')}. Your data is safe but read-only. <Link href="/app/billing">Update billing</Link></p>}
        <RecordsProvider canEdit={canEdit(ctx)} ai={hasFeature(org, 'ai')} credentials={hasFeature(org, 'credentials')}>{children}</RecordsProvider>
        <ResponsiveTables />
      </div>
    </div>
  );
}
