'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';

/** Ends the session on this device and goes to the sign-in page. */
export default function SignOutButton({ className = 'btn ghost sm', label = 'Sign out' }: { className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await signOut({ callbackUrl: '/login?signedout=1' }); }
    // If the sign-out request can't reach the server, the session cookie is still dropped by going to the endpoint directly.
    catch { window.location.href = '/api/auth/signout'; }
  }
  return <button type="button" className={className} onClick={go} disabled={busy}>{busy ? 'Signing out…' : label}</button>;
}
