'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DOC_STATUS, HIRING_DOCS, HIRING_DOC_KINDS, type DocStatus, type HiringDocKind } from '@/lib/hiring-docs';

/** Hiring documents: what HR asks for, what the candidate sends from their page, and HR's review. */

const PICKABLE = HIRING_DOC_KINDS.filter((k) => k !== 'other');

/** Checkboxes for the documents to ask for, plus one of your own. */
export function DocRequestPicker({ value, onChange, other, onOther, legend = 'Documents to ask for' }: {
  value: HiringDocKind[]; onChange: (v: HiringDocKind[]) => void; other?: string; onOther?: (v: string) => void; legend?: string;
}) {
  return (
    <fieldset className="docpick">
      <legend>{legend}</legend>
      {PICKABLE.map((k) => (
        <label key={k} className="check">
          <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />
          {HIRING_DOCS[k].label}{HIRING_DOCS[k].sensitive && <span className="muted"> · admins only</span>}
        </label>
      ))}
      {onOther && <label className="full"><span>Something else (optional)</span><input value={other ?? ''} maxLength={80} placeholder="e.g. Copy of OSHA 10 card" onChange={(e) => onOther(e.target.value)} /></label>}
      {value.includes('i9_docs') && <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>For the I-9 they choose their own documents from the official lists. Don’t ask for specific ones — that’s against federal rules.</p>}
    </fieldset>
  );
}

// ---- the candidate's side ----

export type WorkerDoc = { id: string; label: string; hint: string | null; link: { href: string; text: string } | null; sensitive: boolean; status: DocStatus; note: string | null; maxFiles: number; files: { id: string; name: string }[] };

export function WorkerDocs({ token, docs, onChange }: { token: string; docs: WorkerDoc[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const waiting = docs.filter((d) => d.status === 'REQUESTED' || d.status === 'REJECTED').length;

  async function upload(files: FileList) {
    if (!target) return;
    setBusy(target); setMsg(null);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData(); fd.set('docId', target); fd.set('file', f);
        const r = await fetch(`/api/public/documents/${token}`, { method: 'POST', body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setMsg({ text: j.error ?? 'The upload failed. Try again.', bad: true }); break; }
        setMsg({ text: j.message });
      }
    } catch { setMsg({ text: 'Couldn’t connect. Check your signal and try again.', bad: true }); }
    finally { setBusy(null); setTarget(null); onChange(); }
  }
  async function remove(docId: string, fileId: string) {
    setBusy(docId); setMsg(null);
    const r = await fetch(`/api/public/documents/${token}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, fileId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null); setMsg(r.ok ? { text: j.message } : { text: j.error ?? 'Couldn’t remove it.', bad: true }); onChange();
  }

  return (
    <section className="card" id="documents" aria-label="Documents to send">
      <h2 style={{ marginTop: 0 }}>Documents to send{waiting ? <span className="pill a" style={{ marginLeft: 8, fontSize: 13, verticalAlign: 'middle' }}>{waiting} needed</span> : null}</h2>
      <p className="muted" style={{ marginTop: 0 }}>Upload them here — a photo from your phone is fine. They go straight to your employer’s secure records, so please don’t send them by email or text.</p>
      <ul className="plainlist docs">{docs.map((d) => (
        <li key={d.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{d.label}</b>{d.sensitive && <span className="muted"> · private</span>}
            {d.status === 'REJECTED' && d.note && <div className="warn">Please send it again: {d.note}</div>}
            {d.hint && d.status !== 'ACCEPTED' && <div className="muted">{d.hint}</div>}
            {d.link && d.status !== 'ACCEPTED' && <div><a href={d.link.href} target="_blank" rel="noopener noreferrer">{d.link.text}</a></div>}
            {d.files.length > 0 && d.status !== 'REJECTED' && <ul className="filelist">{d.files.map((f) => (
              <li key={f.id}><span>📎 {f.name}</span>{d.status !== 'ACCEPTED' && <button className="btn ghost sm" disabled={!!busy} onClick={() => remove(d.id, f.id)} aria-label={`Remove ${f.name}`}>Remove</button>}</li>
            ))}</ul>}
            {d.status !== 'ACCEPTED' && (d.status === 'REJECTED' || d.files.length < d.maxFiles) && (
              <button className="btn sm" style={{ marginTop: 6 }} disabled={!!busy} onClick={() => { setTarget(d.id); file.current?.click(); }}>
                {busy === d.id ? 'Sending…' : d.files.length && d.status !== 'REJECTED' ? 'Add another page' : 'Take a photo or choose a file'}
              </button>
            )}
          </div>
          <span className={`pill ${d.status === 'ACCEPTED' ? 'g' : d.status === 'REJECTED' ? 'r' : d.status === 'RECEIVED' ? '' : 'a'}`}>{d.status === 'REQUESTED' ? 'Needed' : d.status === 'RECEIVED' ? 'Sent' : d.status === 'ACCEPTED' ? 'Accepted' : 'Send again'}</span>
        </li>
      ))}</ul>
      <input ref={file} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ''; }} />
      {msg && <p className={msg.bad ? 'error' : 'okc'} role="status">{msg.text}</p>}
    </section>
  );
}

// ---- HR's side, on the candidate's record ----

type Doc = { id: string; kind: string; label: string; sensitive: boolean; status: DocStatus; note: string | null; viaOffer: boolean; viaOnboarding: boolean; receivedAt: string | null; canOpen: boolean; files: { id: string; name: string; size: number }[] };
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function CandidateDocs({ candidateId, canEdit, toast, hasContact }: { candidateId: string; canEdit: boolean; toast: (m: string, bad?: boolean) => void; hasContact: { email: boolean; phone: boolean } }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [kinds, setKinds] = useState<HiringDocKind[]>(['i9_docs', 'w4', 'direct_deposit']);
  const [other, setOther] = useState('');
  const [channels, setChannels] = useState<('email' | 'sms')[]>(hasContact.email ? ['email'] : hasContact.phone ? ['sms'] : []);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await fetch(`/api/candidates/${candidateId}/documents`); setDocs(r.ok ? await r.json() : []); }, [candidateId]);
  useEffect(() => { load(); }, [load]);
  async function call(url: string, method: string, body: object | undefined, ok: (j: { sent?: string[]; problems?: string[]; requested?: number; skipped?: number }) => string) {
    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error ?? 'That didn’t work. Try again.', true); return false; }
      toast([ok(j), ...(j.problems ?? [])].join(' '), !!j.problems?.length); await load(); return true;
    } finally { setBusy(false); }
  }
  const via = (d: Doc) => (d.viaOnboarding ? ' · onboarding' : d.viaOffer ? ' · with the offer' : '');
  const waiting = docs?.filter((d) => d.status === 'RECEIVED').length ?? 0;

  return (
    <section className="sec"><h3>Hiring documents {docs && <span className="muted">{docs.length}</span>}{waiting > 0 && <span className="pill a" style={{ marginLeft: 6 }}>{waiting} to review</span>}</h3>
      {docs === null ? <p className="muted">Loading…</p> : !docs.length && !asking ? <p className="muted">Nothing asked for yet. Ask for their I-9 documents, tax and direct deposit forms, certifications and more — they send them from a private link.</p> : (
        <div className="list">{docs.map((d) => (
          <div key={d.id} className="li" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className="x" style={{ flex: '1 1 240px' }}>
              <b>{d.label}</b>
              <span className="muted">{[d.receivedAt && d.status !== 'REQUESTED' ? `Sent ${new Date(d.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Not sent yet', via(d).slice(3), d.sensitive ? 'admins only' : ''].filter(Boolean).join(' · ')}</span>
              {d.status === 'REJECTED' && d.note && <span className="muted">Sent back: {d.note}</span>}
              {d.files.length > 0 && <span className="muted">{d.files.map((f, i) => <span key={f.id}>{i ? ' · ' : ''}{d.canOpen ? <a href={`/api/hiring-documents/${d.id}/file?f=${f.id}`} target="_blank" rel="noopener noreferrer">{f.name}</a> : f.name} ({kb(f.size)})</span>)}</span>}
              {d.sensitive && !d.canOpen && d.files.length > 0 && <span className="muted">Only owners and admins can open tax, bank and identity documents.</span>}
              {rejecting === d.id && (
                <span className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  <input style={{ flex: '1 1 200px' }} autoFocus value={reason} maxLength={300} placeholder="What’s wrong? e.g. The photo is blurry" aria-label="Why it’s being sent back" onChange={(e) => setReason(e.target.value)} />
                  <button className="btn sm" disabled={busy || reason.trim().length < 3} onClick={async () => { if (await call(`/api/hiring-documents/${d.id}`, 'PATCH', { action: 'reject', note: reason, channels }, (j) => (j.sent?.length ? 'Sent back, and they were asked to send it again.' : 'Sent back.'))) { setRejecting(null); setReason(''); } }}>Send back</button>
                  <button className="btn ghost sm" onClick={() => setRejecting(null)}>Cancel</button>
                </span>
              )}
            </span>
            <span className={`pill ${DOC_STATUS[d.status].pill}`}>{d.status === 'RECEIVED' ? 'To review' : DOC_STATUS[d.status].text}</span>
            {canEdit && rejecting !== d.id && <span className="row" style={{ gap: 6 }}>
              {d.status === 'RECEIVED' && <button className="btn sm" disabled={busy} onClick={() => call(`/api/hiring-documents/${d.id}`, 'PATCH', { action: 'accept' }, () => 'Accepted.')}>Accept</button>}
              {(d.status === 'RECEIVED' || d.status === 'ACCEPTED') && <button className="btn ghost sm" disabled={busy} onClick={() => { setRejecting(d.id); setReason(''); }}>Send back</button>}
              {d.status === 'REQUESTED' && !d.viaOnboarding && <button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Stop asking for ${d.label}?`) && call(`/api/hiring-documents/${d.id}`, 'DELETE', undefined, () => 'Request withdrawn.')}>Withdraw</button>}
            </span>}
          </div>
        ))}</div>
      )}
      {canEdit && (asking ? (
        <div className="subform">
          <DocRequestPicker value={kinds} onChange={setKinds} other={other} onOther={setOther} />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="muted">Send them the link by</span>
            <label className="check"><input type="checkbox" disabled={!hasContact.email} checked={channels.includes('email')} onChange={(e) => setChannels(e.target.checked ? [...channels, 'email'] : channels.filter((c) => c !== 'email'))} /> Email</label>
            <label className="check"><input type="checkbox" disabled={!hasContact.phone} checked={channels.includes('sms')} onChange={(e) => setChannels(e.target.checked ? [...channels, 'sms'] : channels.filter((c) => c !== 'sms'))} /> Text</label>
          </div>
          <div className="row">
            <button className="btn sm" disabled={busy || (!kinds.length && !other.trim())} onClick={async () => { if (await call(`/api/candidates/${candidateId}/documents`, 'POST', { kinds, other: other.trim() || undefined, channels }, (j) => `${j.requested ? `Asked for ${j.requested} document${j.requested === 1 ? '' : 's'}` : 'Already asked for'}${j.sent?.length ? `; sent the link by ${j.sent.map((c) => (c === 'sms' ? 'text' : 'email')).join(' and ')}.` : '.'}`)) { setAsking(false); setOther(''); } }}>Ask for documents</button>
            <button className="btn ghost sm" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      ) : <div className="row"><button className="btn ghost sm" onClick={() => setAsking(true)}>Request documents</button></div>)}
    </section>
  );
}
