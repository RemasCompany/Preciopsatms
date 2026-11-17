import { requirePageContext } from '@/lib/tenant';
import { PLANS, planView } from '@/lib/plans';
import { billingQuantity } from '@/lib/stripe';
import BillingButtons from '@/components/BillingButtons';
import { SALES_EMAIL } from '@/lib/contact';

export default async function Billing() {
  const { org, role } = await requirePageContext();
  const billed = await billingQuantity(org);
  const employees = org.kind === 'EMPLOYER' ? billed : 0;
  const perSeat = org.kind !== 'EMPLOYER' && PLANS[org.plan].perSeat;
  if (org.complimentary) return (
    <>
      <h1>Billing</h1>
      <p className="card banner" role="status"><b>{org.name}</b> uses Preciops on a complimentary <b>{planView(org.plan, org.kind).name}</b> plan. Every {planView(org.plan, org.kind).name} feature is included, for as many users and employees as you need, at no charge. There’s nothing to pay or set up here.</p>
      <p className="muted">AI credits used this period: {org.aiCreditsUsed} of {PLANS[org.plan].monthlyAiCredits}</p>
      <p className="muted">Questions? Email <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>.</p>
    </>
  );
  return (
    <>
      <h1>Billing</h1>
      <p className="muted">Current plan: <b>{planView(org.plan, org.kind).name}</b>{org.kind === 'EMPLOYER' && <> · {employees} active employee{employees === 1 ? '' : 's'} billed</>}{perSeat && <> · {billed} user{billed === 1 ? '' : 's'} billed{PLANS[org.plan].minSeats > 1 ? ` (${PLANS[org.plan].minSeats}-user minimum)` : ''}</>} · Status: {org.subscriptionStatus.replace('_', ' ')}
        {org.currentPeriodEnd && ` · Renews ${org.currentPeriodEnd.toLocaleDateString()}`} · AI credits used this period: {org.aiCreditsUsed} of {PLANS[org.plan].monthlyAiCredits}</p>
      {role === 'OWNER' ? <BillingButtons hasSubscription={!!org.stripeSubscriptionId} current={org.plan} kind={org.kind} /> : <p className="muted">Only the account owner can change billing.</p>}
      <p className="muted">Questions about plans or billing? Email <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>.</p>
    </>
  );
}
