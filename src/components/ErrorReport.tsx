'use client';
import { useEffect } from 'react';

/** Shown when a page crashes: reports it once and offers a retry. */
export default function ErrorReport({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ message: String(error.message).slice(0, 1000), stack: error.stack?.slice(0, 8000), path: window.location.pathname, digest: error.digest }) }).catch(() => {});
  }, [error]);
  return (
    <div className="card" role="alert" style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
      <p className="muted">This page hit an error. We’ve been notified. Your data is safe — try again, and if it keeps happening, reload the page.</p>
      <button className="btn" onClick={reset}>Try again</button>
    </div>
  );
}
