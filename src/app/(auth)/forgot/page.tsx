'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function Forgot() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: new FormData(e.currentTarget).get('email') }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setMsg(j.message); else setErr(j.error ?? 'Something went wrong. Try again.');
  }
  return (
    <main className="public" style={{ maxWidth: 420 }}>
      <h1>Reset your password</h1>
      {msg ? <p className="card banner" role="status">{msg}</p> : (
        <form className="card" onSubmit={submit}>
          <p className="muted" style={{ marginTop: 0 }}>Enter the email you sign in with and we’ll send you a link to choose a new password.</p>
          <label>Email<input name="email" type="email" required autoComplete="email" /></label>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <p className="muted"><Link href="/login">Back to sign in</Link></p>
    </main>
  );
}
