'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function Signup() {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr('');
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const r = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    if (!r.ok) { setErr((await r.json()).error ?? 'Could not create your account'); setBusy(false); return; }
    await signIn('credentials', { email: f.email, password: f.password, callbackUrl: '/app/billing?welcome=1' });
  }
  return (
    <main className="public" style={{ maxWidth: 460 }}>
      <h1>Start your free trial</h1><p className="muted">No credit card needed to start.</p>
      <form className="card" onSubmit={submit}>
        <label>Company name<input name="company" required /></label>
        <label>Your name<input name="name" required autoComplete="name" /></label>
        <label>Work email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password (10+ characters)<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="muted" style={{ fontSize: 13 }}>By continuing you agree to the Terms of Service and Privacy Policy.</p>
      </form>
    </main>
  );
}
