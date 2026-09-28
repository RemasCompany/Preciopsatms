'use client';
import { PLANS, type PlanId } from '@/lib/plans';

async function go(path: string, body?: object) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json(); if (j.url) window.location.href = j.url; else alert(j.error ?? 'Something went wrong');
}

export default function BillingButtons({ hasSubscription, current }: { hasSubscription: boolean; current: PlanId }) {
  if (hasSubscription) return <button className="btn" onClick={() => go('/api/stripe/portal')}>Manage plan, seats, payment method and invoices</button>;
  return (
    <div className="plans">
      {(Object.keys(PLANS) as PlanId[]).map((id) => (
        <div className="plan" key={id}><b>{PLANS[id].name}{id === current ? ' (trial)' : ''}</b><div className="price">{PLANS[id].displayPrice}</div><p className="muted">{PLANS[id].blurb}</p>
          {id === 'enterprise' ? <a className="btn ghost" href="mailto:sales@preciopsatms.com">Talk to sales</a> : <button className="btn" onClick={() => go('/api/stripe/checkout', { plan: id })}>Choose {PLANS[id].name}</button>}</div>
      ))}
    </div>
  );
}
