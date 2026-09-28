import Link from 'next/link';
import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { org } = await requirePageContext();
  const nav: [string, string, boolean][] = [
    ['/app', 'Dashboard', true], ['/app/jobs', 'Jobs', true], ['/app/candidates', 'Candidates', true],
    ['/app/timesheets', 'Timesheets & payroll', hasFeature(org, 'timesheets')], ['/app/documents', 'E-signatures', hasFeature(org, 'esign')],
    ['/app/eeo', 'EEO reporting', hasFeature(org, 'eeo')], ['/app/team', 'Team', true], ['/app/billing', 'Billing', true],
  ];
  const trialDays = org.trialEndsAt ? Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 864e5) : 0;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main"><b>Preciops ATMS<small style={{ display: 'block', fontSize: 12, fontWeight: 400, color: '#C9D3E3' }}>{org.shortName ?? org.name}</small></b>
        {nav.filter(([, , on]) => on).map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <div className="main">
        {org.subscriptionStatus === 'trialing' && trialDays > 0 && <p className="card" style={{ margin: '0 0 16px' }}>{trialDays} days left in your trial. <Link href="/app/billing">Choose a plan</Link></p>}
        {!['trialing', 'active'].includes(org.subscriptionStatus) && <p className="card error" style={{ margin: '0 0 16px' }}>Your subscription is {org.subscriptionStatus.replace('_', ' ')}. Your data is safe but read-only. <Link href="/app/billing">Update billing</Link></p>}
        {children}
      </div>
    </div>
  );
}
