'use client';
import { useState } from 'react';

export default function TestEmail() {
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(false); const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setMsg('');
    const r = await fetch('/api/platform/test-email', { method: 'POST' }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusy(false); setErr(!r?.ok); setMsg(r?.ok ? j.message : j.error ?? 'That didn’t work. Try again.');
  }
  return <span><button type="button" className="btn ghost sm" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send me a test email'}</button>{msg && <span className={err ? 'error' : 'muted'} role="status" style={{ marginLeft: 8 }}>{msg}</span>}</span>;
}
