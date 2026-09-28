import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature, type Feature } from '@/lib/plans';
import { RecordsProvider } from '@/components/Records';

const NAV: [string, [href: string, label: string, feature?: Feature][]][] = [
  ['Recruiting', [['/app', 'Dashboard'], ['/app/pipeline', 'Pipeline'], ['/app/jobs', 'Jobs'], ['/app/candidates', 'Candidates'], ['/app/timesheets', 'Timesheets & payroll', 'timesheets']]],
  ['Sales', [['/app/leads', 'Lead generation', 'leads'], ['/app/clients', 'Clients & contacts', 'crm']]],
  ['Operations', [['/app/vendors', 'Vendors', 'vendors'], ['/app/documents', 'E-signatures', 'esign'], ['/app/eeo', 'EEO reporting', 'eeo'], ['/app/team', 'Team'], ['/app/billing', 'Billing']]],
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const { org } = ctx;
  const trialDays = org.trialEndsAt ? Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 864e5) : 0;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main"><b>Preciops ATMS<small style={{ display: 'block', fontSize: 12, fontWeight: 400, color: '#C9D3E3' }}>{org.shortName ?? org.name}</small></b>
        {NAV.map(([group, items]) => {
          const shown = items.filter(([, , f]) => !f || hasFeature(org, f));
          return shown.length ? <div key={group} className="navgroup"><span>{group}</span>{shown.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</div> : null;
        })}
      </nav>
      <div className="main">
        {org.subscriptionStatus === 'trialing' && trialDays > 0 && <p className="card" style={{ margin: '0 0 16px' }}>{trialDays} days left in your trial. <Link href="/app/billing">Choose a plan</Link></p>}
        {!['trialing', 'active'].includes(org.subscriptionStatus) && <p className="card error" style={{ margin: '0 0 16px' }}>Your subscription is {org.subscriptionStatus.replace('_', ' ')}. Your data is safe but read-only. <Link href="/app/billing">Update billing</Link></p>}
        <RecordsProvider canEdit={canEdit(ctx)}>{children}</RecordsProvider>
      </div>
    </div>
  );
}
