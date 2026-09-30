'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function Reset({ params }: { params: { token: string } }) {
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/auth/reset?token=${encodeURIComponent(params.token)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (r.ok) setEmail(j.email); else setErr(j.error ?? 'This link isn’t working.');
    });
  }, [params.token]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('');
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('confirm')) { setErr('The two passwords don’t match.'); return; }
    setBusy(true);
    const r = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: params.token, password: f.get('password') }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setDone(true); else setErr(j.error ?? 'Something went wrong. Try again.');
  }
  return (
    <main className="public" style={{ maxWidth: 420 }}>
      <h1>Choose a new password</h1>
      {done ? (
        <p className="card banner" role="status">Your password is changed and you’ve been signed out everywhere else. <Link href="/login">Sign in</Link></p>
      ) : email ? (
        <form className="card" onSubmit={submit}>
          <p className="muted" style={{ marginTop: 0 }}>For {email}</p>
          <label>New password<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
          <label>Type it again<input name="confirm" type="password" required minLength={10} autoComplete="new-password" /></label>
          <p className="muted">At least 10 characters.</p>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
        </form>
      ) : err ? (
        <p className="card error" role="alert">{err} <Link href="/forgot">Get a new link</Link></p>
      ) : <p className="muted">Checking your link…</p>}
    </main>
  );
}
