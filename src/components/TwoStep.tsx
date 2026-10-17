'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Status = { enabled: boolean; enabledAt: string | null; recoveryLeft: number };
type Setup = { qr: string; secret: string; url: string; pending: string };

async function send(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Something went wrong.');
  return j;
}

/** The recovery codes, shown once, with copy and download. */
function Recovery({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `Preciops ATMS recovery codes for ${email}\nEach code works once, in place of the code from your app.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'preciops-recovery-codes.txt'; a.click();
    setSaved(true);
  };
  return (
    <div>
      <h3 style={{ marginBottom: 4 }}>Save your recovery codes</h3>
      <p className="muted" style={{ marginTop: 0 }}>If you lose your phone, sign in with one of these instead of a code. Each works once. Keep them somewhere safe, like a password manager. You won’t see them again.</p>
      <ol className="codes" aria-label="Recovery codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
      <div className="row">
        <button type="button" className="btn ghost" onClick={download}>Download</button>
        <button type="button" className="btn ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => setSaved(true))}>Copy</button>
        <button type="button" className="btn" disabled={!saved} onClick={onDone} title={saved ? undefined : 'Download or copy them first'}>I’ve saved them</button>
      </div>
    </div>
  );
}

export default function TwoStep({ email, initial, required = false, blocking = false }: { email: string; initial: Status; required?: boolean; blocking?: boolean }) {
  const router = useRouter();
  const [st, setSt] = useState(initial);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [proof, setProof] = useState('');
  const [mode, setMode] = useState<'' | 'off' | 'new'>('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const start = () => run(async () => { setSetup(await send('POST', '/api/account/two-step')); setCode(''); setProof(''); });
  const confirm = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    const j = await send('PUT', '/api/account/two-step', { pending: setup!.pending, code, ...(st.enabled ? { proof } : {}) });
    setCodes(j.recoveryCodes); setSetup(null); setCode('');
    setSt({ enabled: true, enabledAt: new Date().toISOString(), recoveryLeft: j.recoveryCodes.length });
  }); };
  const manage = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    if (mode === 'off') { await send('DELETE', '/api/account/two-step', { code }); setSt({ enabled: false, enabledAt: null, recoveryLeft: 0 }); }
    else { const j = await send('POST', '/api/account/two-step/recovery', { code }); setCodes(j.recoveryCodes); setSt((s) => ({ ...s, recoveryLeft: j.recoveryCodes.length })); }
    setMode(''); setCode('');
  }); };
  // When this screen was standing in for the app (company requirement), carry on to it once they're done.
  const done = () => { setCodes(null); if (blocking) window.location.reload(); else router.refresh(); };

  return (
    <section className="card" aria-labelledby="two-step-h">
      <h2 id="two-step-h" style={{ marginTop: 0 }}>Two-step sign-in</h2>
      {codes ? <Recovery codes={codes} email={email} onDone={done} /> : setup ? (
        <form onSubmit={confirm}>
          <ol className="steps">
            <li>Open an authenticator app on your phone: Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar.</li>
            <li>Add an account and scan this code.
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made on the server */}
              <div className="qr"><img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} /></div>
              <p className="muted">Can’t scan it? Enter this key instead: <code>{setup.secret}</code></p>
            </li>
            <li><label>Enter the 6-digit code it shows<input aria-label="Code from the new app" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus /></label></li>
            {st.enabled && <li><label>And a code from your old phone, or a recovery code<input aria-label="Code from the old phone" value={proof} onChange={(e) => setProof(e.target.value)} required maxLength={20} /></label></li>}
          </ol>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row"><button className="btn" disabled={busy}>{busy ? 'Checking…' : st.enabled ? 'Move to this phone' : 'Turn on'}</button><button type="button" className="btn ghost" onClick={() => { setSetup(null); setErr(''); }}>Cancel</button></div>
        </form>
      ) : st.enabled ? (
        <>
          <p><span className="pill g">On</span> since {new Date(st.enabledAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. You’ll enter a code from your authenticator app after your password.</p>
          <p className={st.recoveryLeft <= 2 ? 'warn' : 'muted'}>{st.recoveryLeft} recovery code{st.recoveryLeft === 1 ? '' : 's'} left.{st.recoveryLeft <= 2 ? ' Make new ones so you don’t get locked out.' : ''}</p>
          {mode ? (
            <form onSubmit={manage}>
              <label>{mode === 'off' ? 'To turn it off, enter' : 'To make new recovery codes, enter'} a code from your app (or a recovery code)
                <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required autoFocus maxLength={20} /></label>
              {err && <p className="error" role="alert">{err}</p>}
              <div className="row"><button className="btn" disabled={busy}>{mode === 'off' ? 'Turn off' : 'Make new codes'}</button><button type="button" className="btn ghost" onClick={() => { setMode(''); setErr(''); setCode(''); }}>Cancel</button></div>
            </form>
          ) : (
            <div className="row">
              <button className="btn ghost" onClick={start} disabled={busy}>Move to a new phone</button>
              <button className="btn ghost" onClick={() => setMode('new')}>New recovery codes</button>
              {required ? <span className="muted">Your company requires two-step sign-in, so it stays on.</span>
                : <button className="btn ghost" onClick={() => setMode('off')}>Turn off</button>}
            </div>
          )}
        </>
      ) : (
        <>
          <p>{required ? 'Your company requires two-step sign-in. Set it up to continue.' : 'Add a second step after your password: a code from an authenticator app on your phone. Someone who learns your password still can’t get in.'}</p>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Set up two-step sign-in'}</button>
        </>
      )}
    </section>
  );
}

/** For admins on the Team page: require it for everyone. */
export function RequireTwoStep({ required, missing, canEdit, meOn }: { required: boolean; missing: number; canEdit: boolean; meOn: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState('');
  const toggle = async (v: boolean) => {
    setErr('');
    try { await send('PATCH', '/api/settings/two-step', { required: v }); router.refresh(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <section className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Two-step sign-in</h2>
      <label className="check"><input type="checkbox" checked={required} disabled={!canEdit} onChange={(e) => toggle(e.target.checked)} /> Require it for everyone on the team</label>
      <p className="muted">{required
        ? missing ? `${missing} teammate${missing === 1 ? ' hasn’t' : 's haven’t'} set it up yet. They’ll be asked to before they can use the app.` : 'Everyone has it on.'
        : `Each person can turn it on under My sign-in.${canEdit && !meOn ? ' Turn it on for yourself before requiring it.' : ''}`}</p>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
