'use client';
import { useState } from 'react';

/** Shown in the app until the signed-in user confirms their email. */
export default function VerifyBanner({ email }: { email: string }) {
  const [note, setNote] = useState('');
  async function resend() {
    const r = await fetch('/api/auth/verify/resend', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setNote(r.ok ? j.message ?? 'Sent.' : j.error ?? 'That didn’t work. Try again.');
  }
  return <p className="card banner">Please confirm your email address — we sent a link to {email}. {note ? <span role="status">{note}</span> : <button className="linkbtn" onClick={resend}>Send it again</button>}</p>;
}
