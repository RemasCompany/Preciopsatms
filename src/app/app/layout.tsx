import Link from 'next/link';
import { requirePageContext, canEdit, needsTwoStep } from '@/lib/tenant';
import TwoStep from '@/components/TwoStep';
import { status } from '@/lib/two-step';
import { hasFeature, type Feature } from '@/lib/plans';
import { RecordsProvider } from '@/components/Records';
import AppNav, { type NavGroup } from '@/components/AppNav';
import ResponsiveTables from '@/components/ResponsiveTables';
import VerifyBanner from '@/components/VerifyBanner';
import { unreadCount } from '@/lib/sms-inbox';
import { currentBranch } from '@/lib/branches';
import BranchSwitcher from '@/components/BranchSwitcher';
import InboxButton from '@/components/InboxButton';
import { ASSISTANT_NAME } from '@/lib/assistant-name';
import { Suspense } from 'react';

type Nav = [string, [href: string, label: string, feature?: Feature][]][];
const NAV: Nav = [
  ['Recruiting', [['/app', 'Dashboard'], ['/app/inbox', 'Inbox', 'messaging'], ['/app/assistant', ASSISTANT_NAME, 'ai'], ['/app/pipeline', 'Pipeline'], ['/app/interviews', 'Interviews', 'ats'], ['/app/redeploy', 'Redeployment', 'ats'], ['/app/jobs', 'Jobs'], ['/app/candidates', 'Candidates'], ['/app/onboarding', 'Onboarding', 'onboarding'], ['/app/everify', 'E-Verify', 'onboarding'], ['/app/credentials', 'Credentials', 'credentials'], ['/app/training', 'Training', 'training'], ['/app/schedule', 'Schedule', 'scheduling'], ['/app/timeclock', 'Time clock', 'timeclock'], ['/app/engagement', 'Engagement', 'engagement'], ['/app/referrals', 'Referrals', 'engagement'], ['/app/timesheets', 'Timesheets & payroll', 'timesheets'], ['/app/payroll', 'Payroll runs', 'payrollRuns'], ['/app/planning', 'Labor planning', 'timesheets'], ['/app/invoices', 'Invoices', 'invoicing'], ['/app/vms', 'VMS programs', 'vms']]],
  ['Sales', [['/app/leads', 'Lead generation', 'leads'], ['/app/clients', 'Clients & contacts', 'crm'], ['/app/deals', 'Deals', 'crm'], ['/app/sales', 'Sales metrics', 'crm'], ['/app/reports', 'Reports']]],
  ['Operations', [['/app/employees', 'Our employees', 'people'], ['/app/time-off', 'Staff time off', 'timeoff'], ['/app/reviews', 'Staff reviews', 'reviews'], ['/app/vendors', 'Vendors', 'vendors'], ['/app/documents', 'E-signatures', 'esign'], ['/app/eeo', 'EEO reporting', 'eeo'], ['/app/compliance', 'Compliance'], ['/app/hr-audit', 'HR audit', 'hrAudit'], ['/app/aca', 'ACA tracking', 'aca'], ['/app/tasks', 'Tasks'], ['/app/team', 'Team'], ['/app/account', 'My sign-in'], ['/app/settings', 'Settings & data'], ['/app/audit', 'Audit log'], ['/app/billing', 'Billing']]],
];
// Employers: the same tools, grouped around their own people. Client, sales and vendor pages aren't shown.
const EMPLOYER_NAV: Nav = [
  ['Hiring', [['/app', 'Dashboard'], ['/app/inbox', 'Inbox', 'messaging'], ['/app/assistant', ASSISTANT_NAME, 'ai'], ['/app/pipeline', 'Pipeline'], ['/app/interviews', 'Interviews', 'ats'], ['/app/jobs', 'Jobs'], ['/app/candidates', 'Candidates'], ['/app/onboarding', 'Onboarding', 'onboarding'], ['/app/everify', 'E-Verify', 'onboarding'], ['/app/referrals', 'Referrals', 'engagement']]],
  ['People', [['/app/employees', 'Employees', 'people'], ['/app/employees/org-chart', 'Org chart', 'people'], ['/app/time-off', 'Time off', 'timeoff'], ['/app/reviews', 'Reviews & goals', 'reviews'], ['/app/offboarding', 'Offboarding', 'people'], ['/app/credentials', 'Credentials', 'credentials'], ['/app/training', 'Training', 'training'], ['/app/engagement', 'Engagement', 'engagement']]],
  ['Time & pay', [['/app/schedule', 'Schedule', 'scheduling'], ['/app/timeclock', 'Time clock', 'timeclock'], ['/app/timesheets', 'Timesheets & payroll', 'timesheets'], ['/app/payroll', 'Payroll runs', 'payrollRuns'], ['/app/planning', 'Labor planning', 'timesheets']]],
  ['Operations', [['/app/documents', 'E-signatures', 'esign'], ['/app/eeo', 'EEO reporting', 'eeo'], ['/app/compliance', 'Compliance'], ['/app/hr-audit', 'HR audit', 'hrAudit'], ['/app/aca', 'ACA tracking', 'aca'], ['/app/reports', 'Reports'], ['/app/tasks', 'Tasks'], ['/app/team', 'Team'], ['/app/account', 'My sign-in'], ['/app/settings', 'Settings & data'], ['/app/audit', 'Audit log'], ['/app/billing', 'Billing']]],
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const { org } = ctx;
  const { branches, branch } = await currentBranch(ctx);
  // Viewers can't open the inbox, so they don't get the button.
  const showInbox = hasFeature(org, 'messaging') && ctx.role !== 'VIEWER';
  const unread = showInbox ? await unreadCount(ctx.tdb) : 0;
  const trialDays = org.trialEndsAt ? Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 864e5) : 0;
  return (
    <div className="shell">
      <AppNav company={org.shortName ?? org.name} inboxUnread={showInbox ? unread : null} groups={(org.kind === 'EMPLOYER' ? EMPLOYER_NAV : NAV).map(([g, items]) => [g, items.filter(([h, , f]) => (!f || hasFeature(org, f)) && (!['/app/audit', '/app/invoices', '/app/compliance', '/app/aca', '/app/hr-audit'].includes(h) || ctx.role === 'OWNER' || ctx.role === 'ADMIN') && (!['/app/planning', '/app/redeploy'].includes(h) || ctx.role !== 'VIEWER')).map(([h, l]) => [h, h === '/app/inbox' && unread ? `${l} (${unread})` : l])] as NavGroup).filter(([, items]) => items.length)} />
      <div className="main">
        {(branches.length > 0 || showInbox) && (
          <div className="mainbar">
            {branches.length > 0 && <Suspense><BranchSwitcher branches={branches} current={branch?.id ?? null} label={org.kind === 'EMPLOYER' ? 'Location' : 'Branch'} /></Suspense>}
            {showInbox && <InboxButton unread={unread} className="desk" />}
          </div>
        )}
        {!ctx.user.emailVerifiedAt && <VerifyBanner email={ctx.user.email} />}
        {org.subscriptionStatus === 'trialing' && trialDays > 0 && <p className="card banner">{trialDays} days left in your trial. <Link href="/app/billing">Choose a plan</Link></p>}
        {!['trialing', 'active'].includes(org.subscriptionStatus) && <p className="card banner error">Your subscription is {org.subscriptionStatus.replace('_', ' ')}. Your data is safe but read-only. <Link href="/app/billing">Update billing</Link></p>}
        {/* The company requires two-step sign-in: this stands in for every page until they've set it up. */}
        {needsTwoStep(ctx) ? (<><h1>Set up two-step sign-in</h1><p className="lede">{org.name} asks everyone to use a code from an authenticator app when they sign in. It takes about a minute.</p>
          <TwoStep email={ctx.user.email} initial={await status(ctx.user.id)} required blocking /></>) :
        <RecordsProvider kind={org.kind} canEdit={canEdit(ctx)} ai={hasFeature(org, 'ai')} credentials={hasFeature(org, 'credentials')} portal={hasFeature(org, 'clientPortal')}>{children}</RecordsProvider>}
        <ResponsiveTables />
      </div>
    </div>
  );
}
