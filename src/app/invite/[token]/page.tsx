'use client';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';

type Invite = { company: string; email: string; role: string; hasAccount: boolean };

export default function AcceptInvite({ params }: { params: { token: string } }) {
  const [inv, setInv] = useState<Invite | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/invite/${params.token}`).then(async (r) => { const j = await r.json(); if (r.ok) setInv(j); else setMsg(j.error); });
  }, [params.token]);

  async function accept(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg('');
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password') ?? '');
    const res = await fetch(`/api/invite/${params.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.get('name') ?? undefined, password }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); return setMsg(j.error ?? 'Something went wrong. Try again.'); }
    const r = await signIn('credentials', { email: j.email, password, orgId: j.orgId, redirect: false });
    if (r?.error) { setBusy(false); return setMsg('You joined the team. Sign in to continue.'); }
    window.location.href = '/app';
  }

  if (!inv) return <main className="public" style={{ maxWidth: 460 }}><h1>Join your team</h1><p className={msg ? 'error' : 'muted'}>{msg || 'Loading…'}</p>{msg && <a href="/login">Go to sign in</a>}</main>;
  return (
    <main className="public" style={{ maxWidth: 460 }}>
      <h1>Join {inv.company}</h1>
      <p className="lede">You’ve been invited to Preciops as {inv.role === 'ADMIN' ? 'an admin' : `a ${inv.role.toLowerCase()}`}.</p>
      <form className="card" onSubmit={accept}>
        <label>Email<input value={inv.email} readOnly /></label>
        {!inv.hasAccount && <label>Full name<input name="name" required autoComplete="name" /></label>}
        <label>{inv.hasAccount ? 'Your Preciops password' : 'Choose a password (at least 10 characters)'}
          <input name="password" type="password" required minLength={inv.hasAccount ? 1 : 10} autoComplete={inv.hasAccount ? 'current-password' : 'new-password'} /></label>
        {msg && <p className="error" role="alert">{msg}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Joining…' : inv.hasAccount ? 'Accept and sign in' : 'Create account and join'}</button>
      </form>
    </main>
  );
}
