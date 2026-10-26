import { requirePageContext } from '@/lib/tenant';
import { PLANS, planView } from '@/lib/plans';
import { billingQuantity } from '@/lib/stripe';
import BillingButtons from '@/components/BillingButtons';

export default async function Billing() {
  const { org, role } = await requirePageContext();
  const billed = await billingQuantity(org);
  const employees = org.kind === 'EMPLOYER' ? billed : 0;
  const perSeat = org.kind !== 'EMPLOYER' && PLANS[org.plan].perSeat;
  return (
    <>
      <h1>Billing</h1>
      <p className="muted">Current plan: <b>{planView(org.plan, org.kind).name}</b>{org.kind === 'EMPLOYER' && <> · {employees} active employee{employees === 1 ? '' : 's'} billed</>}{perSeat && <> · {billed} user{billed === 1 ? '' : 's'} billed{PLANS[org.plan].minSeats > 1 ? ` (${PLANS[org.plan].minSeats}-user minimum)` : ''}</>} · Status: {org.subscriptionStatus.replace('_', ' ')}
        {org.currentPeriodEnd && ` · Renews ${org.currentPeriodEnd.toLocaleDateString()}`} · AI credits used this period: {org.aiCreditsUsed} of {PLANS[org.plan].monthlyAiCredits}</p>
      {role === 'OWNER' ? <BillingButtons hasSubscription={!!org.stripeSubscriptionId} current={org.plan} kind={org.kind} /> : <p className="muted">Only the account owner can change billing.</p>}
    </>
  );
}
