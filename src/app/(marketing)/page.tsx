import Link from 'next/link';
import { PLANS, planView, type PlanId } from '@/lib/plans';

const FEATURES = [
  ['Applicant tracking', 'Drag-and-drop pipeline, AI resume parsing and candidate matching, rejection reasons for compliance.'],
  ['Careers page & job boards', 'Hosted careers pages, an embeddable widget for your site, Google for Jobs markup and an auto-updating Indeed feed.'],
  ['CRM & lead generation', 'Clients, contacts, deals and leads with AI scoring and outreach drafts.'],
  ['Timesheets, payroll & invoicing', 'Weekly hours with overtime, payroll export for Gusto, ADP and QuickBooks, and client invoices in one click.'],
  ['E-signatures', 'Offer letters, assignment confirmations and agreements signed remotely with a full audit trail.'],
  ['Vendors & EEO compliance', 'Vendor COI/W-9 tracking, voluntary self-ID and four-fifths adverse impact reporting.'],
  ['People & HR for employers', 'Employee directory, departments, an org chart, pay history, scheduling and a mobile time clock for your own team.'],
];

export default function Home() {
  return (
    <main className="public" style={{ maxWidth: 1100 }}>
      <h1>Preciops ATMS</h1>
      <p className="muted" style={{ fontWeight: 700, fontSize: 18, marginTop: 0 }}>Advanced Talent Management System</p>
      <p className="lede">One workforce platform to recruit, schedule, pay and stay compliant — for staffing agencies placing workers with clients, and for companies managing their own employees.</p>
      <p><Link className="btn" href="/signup">Start your {process.env.TRIAL_DAYS ?? 14}-day free trial</Link> <Link className="btn ghost" href="/login">Sign in</Link></p>
      <div className="plans" style={{ marginTop: 36 }}>{FEATURES.map(([t, d]) => <div className="plan" key={t}><b>{t}</b><p className="muted">{d}</p></div>)}</div>
      <h2 style={{ marginTop: 48 }}>Pricing</h2>
      {(['STAFFING', 'EMPLOYER'] as const).map((kind) => (
        <section key={kind}>
          <h3>{kind === 'STAFFING' ? 'For staffing agencies' : 'For employers'}</h3>
          <div className="plans">
            {(Object.keys(PLANS) as PlanId[]).map((id) => { const p = planView(id, kind); return (
              <div className="plan" key={id}><b>{p.name}</b><div className="price">{p.displayPrice}</div><p className="muted">{p.blurb}</p>
                <Link className="btn" href={id === 'enterprise' ? 'mailto:sales@preciopsatms.com' : `/signup?type=${kind.toLowerCase()}`}>{id === 'enterprise' ? 'Talk to sales' : 'Start free trial'}</Link></div>
            ); })}
          </div>
        </section>
      ))}
      <p className="muted" style={{ marginTop: 40 }}><Link href="/security">Security</Link></p>
    </main>
  );
}
