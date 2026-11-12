'use client';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';

/** The last step of single sign-on: trades the one-time ticket from the callback for a session. */
export default function SsoFinish() {
  const [err, setErr] = useState('');
  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get('ticket');
    if (!ticket) { setErr('That sign-in link is incomplete. Start again.'); return; }
    signIn('sso', { ticket, redirect: false }).then((r) => {
      if (r?.error) setErr('That sign-in link expired or was already used. Start again.'); else window.location.replace('/app');
    });
  }, []);
  return (
    <main className="public" style={{ maxWidth: 420 }}>
      <h1>{err ? 'Couldn’t sign you in' : 'Signing you in…'}</h1>
      {err && <><p className="error" role="alert">{err}</p><p><a href="/login?sso=1">Back to sign in</a></p></>}
    </main>
  );
}
