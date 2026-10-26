'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Status =
  | { state: 'off' | 'none' | 'upgrade' }
  | { state: 'draft' | 'active'; domains: string[]; connectionType: string | null; required: boolean };

// WorkOS connection types, as people know them.
const TYPE: Record<string, string> = { AzureSAML: 'Microsoft Entra ID (SAML)', MicrosoftOAuth: 'Microsoft', GoogleSAML: 'Google Workspace (SAML)', GoogleOAuth: 'Google', OktaSAML: 'Okta', OneLoginSAML: 'OneLogin', JumpCloudSAML: 'JumpCloud', PingFederateSAML: 'PingFederate', ADFSSAML: 'AD FS', GenericSAML: 'SAML', GenericOIDC: 'OpenID Connect' };

/** Settings card: single sign-on through the company's identity provider (Enterprise). */
export default function SsoCard({ status, canEdit, myDomain, notice }: { status: Status; canEdit: boolean; myDomain: string; notice?: string }) {
  const router = useRouter();
  const conn = status.state === 'draft' || status.state === 'active' ? status : null;
  const [domains, setDomains] = useState(conn ? conn.domains.join(', ') : myDomain);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(notice ? { text: notice } : null);
  async function call(method: string, path: string, body?: unknown) {
    setBusy(true); setMsg(null);
    const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ text: j.error ?? 'Something went wrong.', bad: true }); return null; }
    return j;
  }
  const saveDomains = async () => {
    const j = await call('POST', '/api/sso', { domains: domains.split(/[\s,;]+/).filter(Boolean) });
    if (j) { setMsg({ text: 'Saved. Next, connect your identity provider.' }); router.refresh(); }
  };
  const portal = async (open: boolean) => {
    const j = await call('POST', '/api/sso/portal');
    if (!j) return;
    if (open) window.location.href = j.link; else { setLink(j.link); navigator.clipboard?.writeText(j.link).catch(() => {}); }
  };

  return (
    <section className="card" id="sso">
      <h2 style={{ marginTop: 0 }}>Single sign-on</h2>
      <p className="muted" style={{ marginTop: 0 }}>Your team signs in with their work account (Microsoft, Google Workspace, Okta and others) instead of a Preciops password. When IT turns someone’s work account off, their access here ends too.</p>
      {status.state === 'upgrade' ? (
        <p className="muted">Single sign-on is part of the Enterprise plan. <a href="/app/billing">See plans</a></p>
      ) : status.state === 'off' ? (
        <p className="muted">Single sign-on isn’t available on this server yet. The Preciops administrator needs WorkOS keys (WORKOS_API_KEY and WORKOS_CLIENT_ID).</p>
      ) : (
        <>
          {conn && (
            <p><span className={`pill ${status.state === 'active' ? 'g' : 'a'}`}>{status.state === 'active' ? 'On' : 'Waiting for IT'}</span>{' '}
              {conn.state === 'active' ? <>Signing in through <b>{TYPE[conn.connectionType ?? ''] ?? conn.connectionType ?? 'your identity provider'}</b> for {conn.domains.map((d) => `@${d}`).join(', ')}</> : <>Domains: {conn.domains.map((d) => `@${d}`).join(', ')}. Connect your identity provider to finish.</>}</p>
          )}
          {canEdit && (
            <>
              <label><span>{status.state === 'none' ? '1. Your company’s email domain' : 'Email domains'}</span>
                <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="yourcompany.com" /></label>
              <p className="muted" style={{ marginTop: 4 }}>The part after @ in your team’s work emails. Separate several with commas. Each one must already be used by someone on your team.</p>
              <div className="row">
                <button className={status.state === 'none' ? 'btn' : 'btn ghost'} disabled={busy} onClick={saveDomains}>{status.state === 'none' ? 'Save and continue' : 'Save domains'}</button>
              </div>
              {status.state !== 'none' && (
                <>
                  <h3 style={{ marginBottom: 4 }}>{status.state === 'draft' ? '2. Connect your identity provider' : 'Identity provider'}</h3>
                  <p className="muted" style={{ marginTop: 0 }}>{status.state === 'draft' ? 'Set it up yourself, or send the setup link to your IT team. It walks them through Microsoft, Google, Okta and other providers step by step, and works for 5 days.' : 'Change the connection or update certificates in the setup portal.'}</p>
                  <div className="row">
                    <button className="btn" disabled={busy} onClick={() => portal(true)}>{status.state === 'draft' ? 'Open setup' : 'Edit connection'}</button>
                    <button className="btn ghost" disabled={busy} onClick={() => portal(false)}>Copy link for IT</button>
                    {status.state === 'draft' && <button className="btn ghost" disabled={busy} onClick={async () => { const j = await call('POST', '/api/sso/refresh'); if (j) { setMsg({ text: j.state === 'active' ? 'Connected. Your team can now sign in with single sign-on.' : 'Not finished yet. When IT completes the setup and tests it, it turns on here.' }); router.refresh(); } }}>Check status</button>}
                  </div>
                  {link && <label><span>Setup link (copied)</span><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></label>}
                </>
              )}
              {conn?.state === 'active' && (
                <>
                  <label className="check" style={{ marginTop: 14 }}><input type="checkbox" checked={conn.required} disabled={busy}
                    onChange={async (e) => { if (await call('PATCH', '/api/sso/require', { required: e.target.checked })) router.refresh(); }} /> Require single sign-on for everyone</label>
                  <p className="muted" style={{ marginTop: 4 }}>Passwords stop working for your team. Owners can still use their password, so you can get back in if the identity provider has a problem.</p>
                </>
              )}
              {status.state !== 'none' && (
                <p style={{ marginTop: 14 }}><button className="btn ghost sm" disabled={busy} onClick={async () => { if (confirm('Turn off single sign-on? Your team will sign in with their Preciops passwords again (anyone without one can use “Forgot password?”).') && await call('DELETE', '/api/sso')) { setMsg({ text: 'Single sign-on is off.' }); router.refresh(); } }}>Turn off single sign-on</button></p>
              )}
            </>
          )}
        </>
      )}
      {msg && <p className={msg.bad ? 'error' : 'okc'} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
    </section>
  );
}
