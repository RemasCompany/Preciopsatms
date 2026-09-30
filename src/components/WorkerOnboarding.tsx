'use client';
import { useRef, useState } from 'react';

export type WorkerOb = {
  id: string; job: string; startDate: string | null; ready: boolean;
  steps: { id: string; kind: string; label: string; hint: string | null; required: boolean; done: boolean; waived: boolean; mine: boolean; blocked: string | null; contact: Record<string, string> | null }[];
};

/** A new hire's own checklist on their private page: sign, upload and fill in, plus what the recruiter is doing. */
export default function WorkerOnboarding({ token, items, onChange }: { token: string; items: WorkerOb[]; onChange: () => void }) {
  return <>{items.map((ob) => <One key={ob.id} token={token} ob={ob} onChange={onChange} />)}</>;
}

function One({ token, ob, onChange }: { token: string; ob: WorkerOb; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [form, setForm] = useState<string | null>(null);
  const [contact, setContact] = useState({ name: '', relationship: '', phone: '' });
  const file = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const mine = ob.steps.filter((s) => s.mine), theirs = ob.steps.filter((s) => !s.mine);
  const left = mine.filter((s) => !s.done && s.required).length;

  async function post(body: object) {
    const r = await fetch(`/api/public/onboarding/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? 'That didn’t go through. Try again.');
    return j;
  }
  async function sign(id: string) {
    setBusy(id); setMsg(null);
    try { const j = await post({ action: 'sign', stepId: id }); window.location.href = j.url; }
    catch (e) { setMsg({ text: (e as Error).message, bad: true }); setBusy(null); onChange(); }
  }
  async function saveContact(id: string) {
    setBusy(id); setMsg(null);
    try { await post({ action: 'form', stepId: id, data: contact }); setForm(null); setMsg({ text: 'Emergency contact saved.' }); onChange(); }
    catch (e) { setMsg({ text: (e as Error).message, bad: true }); } finally { setBusy(null); }
  }
  async function upload(f: File) {
    if (!uploadFor) return;
    setBusy(uploadFor); setMsg(null);
    const fd = new FormData(); fd.set('stepId', uploadFor); fd.set('file', f);
    const r = await fetch(`/api/public/onboarding/${token}/upload`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(null); setUploadFor(null);
    setMsg(r.ok ? { text: 'Uploaded. Thank you!' } : { text: j.error ?? 'The upload failed. Try again.', bad: true });
    onChange();
  }

  return (
    <section className={`card obcard${ob.ready ? ' ready' : ''}`}>
      <div className="clockhead"><span className="clockstate">{ob.ready ? 'You’re all set to start' : left ? `New-hire steps: ${left} left for you` : 'Waiting on your recruiter'}</span></div>
      <p className="muted" style={{ marginTop: 4 }}>{ob.job}{ob.startDate ? ` · starts ${new Date(`${ob.startDate}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}</p>
      <ol className="oblist">
        {mine.map((s) => (
          <li key={s.id} className={s.done ? 'done' : undefined}>
            <span className="obcheck" aria-hidden="true">{s.done ? '✓' : ''}</span>
            <div className="x">
              <b>{s.label}{!s.required && <span className="muted"> (optional)</span>}</b>
              {s.hint && !s.done && <span className="muted">{s.hint}</span>}
              {s.waived && <span className="muted">Not needed</span>}
              {s.contact && <span className="muted">{s.contact.name} ({s.contact.relationship}) · {s.contact.phone}</span>}
              {!s.done && s.blocked && <span className="muted">{s.blocked}</span>}
              {!s.done && !s.blocked && s.kind === 'SIGN' && <button className="btn sm" disabled={!!busy} onClick={() => sign(s.id)}>{busy === s.id ? 'Opening…' : 'Review and sign'}</button>}
              {!s.done && s.kind === 'UPLOAD' && <button className="btn sm" disabled={!!busy} onClick={() => { setUploadFor(s.id); file.current?.click(); }}>{busy === s.id ? 'Uploading…' : 'Take a photo or choose a file'}</button>}
              {s.kind === 'FORM' && !s.done && form !== s.id && <button className="btn sm" onClick={() => setForm(s.id)}>Add contact</button>}
              {form === s.id && (
                <div className="subform">
                  <label><span>Name</span><input value={contact.name} autoComplete="off" onChange={(e) => setContact({ ...contact, name: e.target.value })} /></label>
                  <label><span>Relationship</span><input value={contact.relationship} placeholder="e.g. Spouse, parent" onChange={(e) => setContact({ ...contact, relationship: e.target.value })} /></label>
                  <label><span>Phone</span><input type="tel" inputMode="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></label>
                  <div className="row"><button className="btn sm" disabled={busy === s.id} onClick={() => saveContact(s.id)}>Save</button><button className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button></div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <input ref={file} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      {msg && <p className={msg.bad ? 'error' : 'okc'} role="status">{msg.text}</p>}
      {theirs.length > 0 && (
        <details className="clockrecent"><summary>What your recruiter takes care of ({theirs.filter((s) => s.done).length} of {theirs.length} done)</summary>
          <ul>{theirs.map((s) => <li key={s.id}><span>{s.label}</span><b>{s.done ? '✓' : 'Pending'}</b></li>)}</ul>
        </details>
      )}
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>For your Form I-9, bring original documents that show your identity and that you can work in the U.S. on your first day. Your tax and direct deposit details go in the payroll system your recruiter will point you to — never send them by text or email.</p>
    </section>
  );
}
