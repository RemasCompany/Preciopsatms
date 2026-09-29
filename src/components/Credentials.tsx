'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import type { Recipient } from './Compose';
import { CREDENTIAL_TYPES, CREDENTIAL_TYPE_NAMES, VERIFY_METHODS, lookupLinks, typeSpec, type CredentialGroup } from '@/lib/credentials';

export type Cred = {
  id: string; type: string; name: string | null; number: string | null; state: string | null; issuedAt: string | null; expiresAt: string | null;
  verifiedAt: string | null; verifiedBy: string | null; verifyMethod: string | null; verifyNote: string | null; hasFile: boolean; notes: string | null;
  label: string; status: { state: string; text: string; level: 'warn' | 'soon' | 'ok'; days: number | null };
};
type Draft = { type: string; name: string; number: string; state: string; issuedAt: string; expiresAt: string; notes: string };

const GROUPS: CredentialGroup[] = ['License', 'Certification', 'Health', 'Screening', 'Other'];
const PILL = { warn: 'r', soon: 'a', ok: 'g' } as const;
const blank: Draft = { type: 'RN license', name: '', number: '', state: '', issuedAt: '', expiresAt: '', notes: '' };
const fmt = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

export function TypeSelect({ value, onChange, name = 'type' }: { value: string; onChange: (v: string) => void; name?: string }) {
  return (
    <select name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      {GROUPS.map((g) => (
        <optgroup key={g} label={g === 'Other' ? 'Other' : `${g}s`.replace('Healths', 'Health records')}>
          {CREDENTIAL_TYPE_NAMES.filter((t) => CREDENTIAL_TYPES[t].group === g).map((t) => <option key={t} value={t}>{t}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Licenses, certifications, health records and screenings for one candidate, with verification and proof on file. */
export default function Credentials({ candidateId, self, canEdit, compose }: { candidateId: string; self: Recipient | null; canEdit: boolean; compose: (r: Recipient) => void }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setCreds(await api(`/api/candidates/${candidateId}/credentials`, 'GET')); } catch (e) { toast((e as Error).message, true); setCreds([]); }
  }, [candidateId, toast]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); router.refresh(); };

  async function save() {
    if (!draft) return;
    const spec = typeSpec(draft.type);
    if (draft.type === 'Other' && !draft.name.trim()) return setError('Name the credential.');
    setBusy(true); setError('');
    const body = { ...draft, name: draft.name || null, number: draft.number || null, state: spec.state || draft.state ? draft.state || null : null, issuedAt: draft.issuedAt || null, expiresAt: draft.expiresAt || null, notes: draft.notes || null };
    try {
      const before = editing ? creds?.find((c) => c.id === editing) : null;
      const saved: Cred = editing ? await api(`/api/credentials/${editing}`, 'PATCH', body) : await api(`/api/candidates/${candidateId}/credentials`, 'POST', body);
      toast(before?.verifiedAt && !saved.verifiedAt ? 'Saved. The changes need to be verified again.' : editing ? 'Saved.' : 'Credential added.');
      setDraft(null); setEditing(null); changed();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(c: Cred) {
    if (!confirm(`Remove ${c.label}?`)) return;
    try { await api(`/api/credentials/${c.id}`, 'DELETE'); toast('Removed.'); changed(); } catch (e) { toast((e as Error).message, true); }
  }
  async function checkNpi(c: Cred) {
    setBusy(true);
    try { const r = await api(`/api/credentials/${c.id}/npi`, 'POST'); toast(r.message, !r.verified); if (r.verified) changed(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  function remind(c: Cred) {
    if (!self) return;
    const when = c.status.state === 'expired' ? `expired on ${fmt(c.expiresAt!)}` : c.expiresAt ? `expires on ${fmt(c.expiresAt)}` : 'isn’t on file yet';
    compose({ ...self, subject: `Please send your renewed ${c.label}`, body: `Hi {{first_name}},\n\nOur records show your ${c.label} ${when}. Please send us a copy of the renewal (a photo or PDF is fine) so we can keep you eligible for shifts.\n\nThank you,\n{{signature}}` });
  }
  const startEdit = (c: Cred) => { setVerifying(null); setEditing(c.id); setError(''); setDraft({ type: c.type, name: c.name ?? '', number: c.number ?? '', state: c.state ?? '', issuedAt: c.issuedAt ?? '', expiresAt: c.expiresAt ?? '', notes: c.notes ?? '' }); };

  const problems = creds?.filter((c) => c.status.level !== 'ok').length ?? 0;
  return (
    <section className="sec" id="credentials">
      <h3>Credentials {creds && <span className="muted">{creds.length}{problems ? ` · ${problems} need attention` : ''}</span>}
        {canEdit && !draft && <button className="btn ghost sm" onClick={() => { setEditing(null); setError(''); setVerifying(null); setDraft(blank); }}>+ Add credential</button>}</h3>
      {!creds ? <p className="muted">Loading…</p> : (
        <div className="list">
          {creds.map((c) => (
            <div key={c.id} className="cred">
              <div className="li">
                <div className="x">
                  <b>{c.label}</b>
                  <span className="muted">{[c.number && `#${c.number}`, c.expiresAt ? `exp. ${fmt(c.expiresAt)}` : null, c.verifiedAt && `verified ${fmt(c.verifiedAt)}${c.verifiedBy ? ` by ${c.verifiedBy}` : ''}`].filter(Boolean).join(' · ') || '—'}</span>
                </div>
                <span className={`pill ${PILL[c.status.level]}`}>{c.status.level === 'ok' ? 'Verified' : c.status.text}</span>
              </div>
              {(c.verifyMethod || c.notes) && <p className="muted credmeta">{[c.verifyMethod && `${c.verifyMethod}${c.verifyNote ? `: ${c.verifyNote}` : ''}`, c.notes].filter(Boolean).join(' · ')}</p>}
              <div className="row credacts">
                {canEdit && !c.verifiedAt && c.type === 'NPI' && c.number && <button className="btn sm" disabled={busy} onClick={() => checkNpi(c)}>Check NPI registry</button>}
                {canEdit && !c.verifiedAt && c.status.state !== 'expired' && c.status.state !== 'incomplete' && <button className="btn ghost sm" onClick={() => { setDraft(null); setVerifying(verifying === c.id ? null : c.id); }}>Verify…</button>}
                {c.hasFile && <a className="btn ghost sm" href={`/api/credentials/${c.id}/file`}>Proof</a>}
                {canEdit && <Upload id={c.id} has={c.hasFile} onDone={changed} />}
                {canEdit && self && c.status.level !== 'ok' && c.status.state !== 'unverified' && <button className="btn ghost sm" onClick={() => remind(c)}>Remind</button>}
                {canEdit && <button className="btn ghost sm" onClick={() => startEdit(c)}>Edit</button>}
                {canEdit && <button className="btn ghost sm" onClick={() => remove(c)} aria-label={`Remove ${c.label}`}>✕</button>}
              </div>
              {verifying === c.id && <VerifyForm cred={c} onDone={() => { setVerifying(null); changed(); }} onCancel={() => setVerifying(null)} />}
            </div>
          ))}
          {!creds.length && !draft && <p className="muted">No credentials on file. Add licenses, certifications (BLS, ACLS), health records and screenings to track their expiration dates.</p>}
        </div>
      )}
      {draft && (
        <div className="subform">
          <div className="form">
            <label className="full"><span>Type</span><TypeSelect value={draft.type} onChange={(type) => setDraft({ ...draft, type })} /></label>
            {(draft.type === 'Other' || draft.type === 'Specialty certification' || typeSpec(draft.type).group === 'License') && (
              <label className="full"><span>{draft.type === 'Other' ? 'Name *' : draft.type === 'Specialty certification' ? 'Certification (e.g. CCRN, CEN)' : 'Specialty (optional)'}</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            )}
            <label><span>{draft.type === 'NPI' ? 'NPI (10 digits)' : 'Number'}{typeSpec(draft.type).number ? '' : ' (optional)'}</span><input value={draft.number} inputMode={draft.type === 'NPI' ? 'numeric' : undefined} onChange={(e) => setDraft({ ...draft, number: e.target.value })} /></label>
            {(typeSpec(draft.type).state || draft.state) && <label><span>Issuing state</span><input value={draft.state} maxLength={2} placeholder="TX" autoCapitalize="characters" onChange={(e) => setDraft({ ...draft, state: e.target.value.toUpperCase() })} /></label>}
            <label><span>Issued</span><input type="date" value={draft.issuedAt} onChange={(e) => setDraft({ ...draft, issuedAt: e.target.value })} /></label>
            <label><span>Expires{typeSpec(draft.type).expires ? '' : ' (if it does)'}</span><input type="date" value={draft.expiresAt} onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })} /></label>
            <label className="full"><span>Notes</span><input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
          </div>
          {editing && creds?.find((c) => c.id === editing)?.verifiedAt && <p className="muted" style={{ fontSize: 13 }}>Changing the type, number, state or dates clears the verification.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row"><button className="btn" onClick={save} disabled={busy}>{editing ? 'Save credential' : 'Add credential'}</button><button className="btn ghost" onClick={() => { setDraft(null); setEditing(null); }}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}

function defaultMethod(type: string): (typeof VERIFY_METHODS)[number] {
  const g = typeSpec(type).group;
  if (type === 'NPI') return 'NPPES NPI registry';
  if (/RN|LPN|APRN|Compact/.test(type)) return 'Nursys QuickConfirm';
  if (g === 'License' || type === 'CNA certification') return 'State board website (primary source)';
  if (g === 'Certification') return 'Issuing organization (e.g. AHA eCard)';
  if (g === 'Health' || g === 'Screening') return 'Lab or vendor report';
  return 'Original document reviewed';
}

function VerifyForm({ cred, onDone, onCancel }: { cred: Cred; onDone: () => void; onCancel: () => void }) {
  const { toast } = useRecords();
  const links = lookupLinks(cred.type);
  const [method, setMethod] = useState<string>(defaultMethod(cred.type));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await api(`/api/credentials/${cred.id}/verify`, 'POST', { method, note }); toast('Marked verified.'); onDone(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="subform">
      <p style={{ margin: '0 0 6px', fontSize: 14 }}>Check {cred.label}{cred.number ? ` #${cred.number}` : ''} at the source, then record how you did it.</p>
      {links.length > 0 && <div className="row" style={{ marginTop: 0 }}>{links.map((l) => <a key={l.url} className="btn ghost sm" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}</div>}
      <label><span>How you verified it</span><select value={method} onChange={(e) => setMethod(e.target.value)}>{VERIFY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
      <label><span>Note (optional)</span><input value={note} maxLength={500} placeholder="e.g. Active, no discipline; screenshot attached" onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row"><button className="btn sm" onClick={go} disabled={busy}>Mark verified</button><button className="btn ghost sm" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function Upload({ id, has, onDone }: { id: string; has: boolean; onDone: () => void }) {
  const { toast } = useRecords();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function up(file: File) {
    setBusy(true);
    const fd = new FormData(); fd.set('file', file);
    const res = await fetch(`/api/credentials/${id}/file`, { method: 'POST', body: fd });
    setBusy(false);
    if (!res.ok) { toast((await res.json().catch(() => ({}))).error ?? 'Upload failed.', true); return; }
    toast('Document attached.'); onDone();
  }
  return <>
    <input ref={ref} type="file" accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = ''; }} />
    <button className="btn ghost sm" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Uploading…' : has ? 'Replace proof' : 'Attach proof'}</button>
  </>;
}
