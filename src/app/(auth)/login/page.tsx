'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

const ERRORS: Record<string, string> = {
  TOO_MANY_ATTEMPTS: 'Too many sign-in attempts. Wait 15 minutes and try again, or reset your password.',
  TWO_STEP_INVALID: 'That code didn’t work. Codes change every 30 seconds, so enter the newest one, or use a recovery code.',
};

export default function Login() {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // After a right password for an account with two-step sign-in, the same form asks for the code.
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [recovery, setRecovery] = useState(false);
  // "Sign in with SSO": the company's identity provider instead of a password (Enterprise).
  const [sso, setSso] = useState(false);
  const [email, setEmail] = useState('');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('sso') || q.get('sso_error')) setSso(true);
    if (q.get('sso_error')) setErr(q.get('sso_error')!.slice(0, 300));
  }, []);

  async function startSso(addr: string) {
    setBusy(true); setErr('');
    const r = await fetch('/api/auth/sso/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.url) { window.location.href = j.url; return; }
    setBusy(false); setErr(j.error ?? 'Something went wrong. Try again.');
  }

  async function attempt(email: string, password: string, code?: string) {
    setBusy(true); setErr('');
    // Signing in to a particular company (from an invite link that sent them here).
    // (next-auth posts every field as text, so leave out the empty ones rather than send "undefined".)
    const orgId = new URLSearchParams(window.location.search).get('org');
    const r = await signIn('credentials', { email, password, ...(code ? { code } : {}), ...(orgId ? { orgId } : {}), redirect: false });
    setBusy(false);
    if (!r?.error) { window.location.href = '/app'; return; }
    if (r.error === 'TWO_STEP_REQUIRED') { setCreds({ email, password }); return; }
    if (r.error === 'SSO_REQUIRED') { setSso(true); setEmail(email); setErr('Your company signs in with single sign-on. Continue with your work account.'); return; }
    setErr(ERRORS[r.error] ?? 'Email or password is incorrect.');
  }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    if (sso) startSso(email);
    else if (creds) attempt(creds.email, creds.password, String(f.get('code') ?? ''));
    else attempt(String(f.get('email')), String(f.get('password')));
  }

  return (
    <main className="public" style={{ maxWidth: 420 }}>
      <h1>{creds ? 'Two-step sign-in' : sso ? 'Sign in with SSO' : 'Sign in'}</h1>
      <form className="card" onSubmit={submit}>
        {sso ? (
          <>
            <p style={{ marginTop: 0 }}>Use your company account (Microsoft, Google, Okta or another sign-in your company set up).</p>
            <label>Work email<input name="email" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          </>
        ) : creds ? (
          <>
            <p style={{ marginTop: 0 }}>{recovery ? 'Enter one of the recovery codes you saved when you set up two-step sign-in. Each works once.' : <>Enter the 6-digit code from your authenticator app for <b>{creds.email}</b>.</>}</p>
            <label>{recovery ? 'Recovery code' : 'Code'}<input key={String(recovery)} name="code" required autoFocus autoComplete="one-time-code" {...(recovery ? { maxLength: 9, placeholder: 'abcd-efgh' } : { inputMode: 'numeric' as const, pattern: '[0-9 ]{6,7}', maxLength: 7 })} /></label>
          </>
        ) : (
          <>
            <label>Email<input name="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
          </>
        )}
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? (sso ? 'Continuing…' : 'Signing in…') : sso ? 'Continue' : creds ? 'Verify' : 'Sign in'}</button>
      </form>
      {creds ? (
        <p className="muted">
          <button type="button" className="linkish" style={{ color: 'var(--accent)', textDecoration: 'underline' }} onClick={() => { setRecovery(!recovery); setErr(''); }}>{recovery ? 'Use a code from my app' : 'Lost your phone? Use a recovery code'}</button>
          {' · '}<button type="button" className="linkish" style={{ color: 'var(--accent)', textDecoration: 'underline' }} onClick={() => { setCreds(null); setRecovery(false); setErr(''); }}>Start over</button>
          <br />No recovery codes either? Ask an admin on your team to reset your two-step sign-in.
        </p>
      ) : sso ? (
        <p className="muted"><button type="button" className="linkish" style={{ color: 'var(--accent)', textDecoration: 'underline' }} onClick={() => { setSso(false); setErr(''); }}>Sign in with a password instead</button></p>
      ) : (
        <p className="muted"><Link href="/forgot">Forgot password?</Link>{' · '}
          <button type="button" className="linkish" style={{ color: 'var(--accent)', textDecoration: 'underline' }} onClick={() => { setSso(true); setErr(''); }}>Sign in with SSO</button></p>
      )}
    </main>
  );
}
