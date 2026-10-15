'use client';
import { PLANS, planView, type OrgKind, type PlanId } from '@/lib/plans';

async function go(path: string, body?: object) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json(); if (j.url) window.location.href = j.url; else alert(j.error ?? 'Something went wrong');
}

export default function BillingButtons({ hasSubscription, current, kind }: { hasSubscription: boolean; current: PlanId; kind: OrgKind }) {
  if (hasSubscription) return <button className="btn" onClick={() => go('/api/stripe/portal')}>Manage plan, {kind === 'EMPLOYER' ? 'employees' : 'seats'}, payment method and invoices</button>;
  return (
    <div className="plans">
      {(Object.keys(PLANS) as PlanId[]).map((id) => { const p = planView(id, kind); return (
        <div className="plan" key={id}><b>{p.name}{id === current ? ' (trial)' : ''}</b><div className="price">{p.displayPrice}</div><p className="muted">{p.blurb}</p>
          {id === 'enterprise' ? <a className="btn ghost" href="mailto:sales@preciopsatms.com">Talk to sales</a> : <button className="btn" onClick={() => go('/api/stripe/checkout', { plan: id })}>Choose {p.name}</button>}</div>
      ); })}
    </div>
  );
}
