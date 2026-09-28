import { requirePageContext } from '@/lib/tenant';
import { PLANS } from '@/lib/plans';
import BillingButtons from '@/components/BillingButtons';

export default async function Billing() {
  const { org, role } = await requirePageContext();
  return (
    <>
      <h1>Billing</h1>
      <p className="muted">Current plan: <b>{PLANS[org.plan].name}</b> · Status: {org.subscriptionStatus.replace('_', ' ')}
        {org.currentPeriodEnd && ` · Renews ${org.currentPeriodEnd.toLocaleDateString()}`} · AI credits used this period: {org.aiCreditsUsed} of {PLANS[org.plan].monthlyAiCredits}</p>
      {role === 'OWNER' ? <BillingButtons hasSubscription={!!org.stripeSubscriptionId} current={org.plan} /> : <p className="muted">Only the account owner can change billing.</p>}
    </>
  );
}
