'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function Verify({ params }: { params: { token: string } }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return; sent.current = true; // the token is single use; don't spend it twice in dev strict mode
    fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: params.token }) }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      setState(r.ok ? { ok: true, text: `Thanks — ${j.email} is confirmed.` } : { ok: false, text: j.error ?? 'This link isn’t working.' });
    });
  }, [params.token]);
  return (
    <main className="public" style={{ maxWidth: 420 }}>
      <h1>Confirm your email</h1>
      {!state ? <p className="muted">Confirming…</p> : <p className={`card ${state.ok ? 'banner' : 'error'}`} role="status">{state.text} <Link href="/app">Go to Preciops</Link></p>}
    </main>
  );
}
