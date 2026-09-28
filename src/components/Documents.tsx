'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';
import { Pill, useRecords } from './Records';
import { DOC_TYPES, DOC_RELATED, type AuditEntry, type DocType } from '@/lib/esign';

type Row = { id: string; title: string; typeLabel: string; forName: string; status: string; created: string; signed: string | null; countersigned: boolean };
type Doc = {
  id: string; type: string; title: string; body: string; status: string; signerName: string; signerEmail: string;
  signerSignature: string | null; signedAt: string | null; counterName: string | null; counterSignature: string | null; counterSignedAt: string | null;
  pdfFileId: string | null; bodySha256: string | null; tokenExpiresAt: string | null; audit: AuditEntry[];
};
const STATUS: Record<string, string> = { DRAFT: 'Draft', SENT: 'Sent', SIGNED: 'Signed', COUNTERSIGNED: 'Countersigned', VOID: 'Void' };
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

export default function Documents({ rows, canEdit, admin }: { rows: Row[]; canEdit: boolean; admin: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<DocType | null>(null);
  return (
    <>
      {canEdit && <div className="bar"><span className="grow" />{(Object.keys(DOC_TYPES) as DocType[]).map((t) => <button key={t} className="btn ghost" onClick={() => setCreating(t)}>+ {DOC_TYPES[t]}</button>)}</div>}
      {rows.length ? (
        <div className="tablewrap"><table><thead><tr><th>Document</th><th>For</th><th>Created</th><th>Signed</th><th>Status</th></tr></thead><tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td><button className="link" onClick={() => setOpenId(d.id)}><b>{d.title}</b></button><div className="muted">{d.typeLabel}</div></td>
              <td>{d.forName}</td>
              <td>{date(d.created)}</td>
              <td>{d.signed ? date(d.signed) : '—'}{d.countersigned && <div className="muted">Countersigned</div>}</td>
              <td><Pill s={STATUS[d.status]} /></td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <div className="card empty"><b>No documents yet</b>Pick a template above to create an offer letter, assignment confirmation or agreement.</div>}
      {creating && <NewDocument type={creating} onClose={() => setCreating(null)} onCreated={(id) => { setCreating(null); setOpenId(id); }} />}
      {openId && <DocumentDrawer id={openId} canEdit={canEdit} admin={admin} onClose={() => setOpenId(null)} />}
    </>
  );
}

function NewDocument({ type, onClose, onCreated }: { type: DocType; onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [relatedType, setRelatedType] = useState<'candidate' | 'vendor' | 'client'>(DOC_RELATED[type] ?? 'candidate');
  const [options, setOptions] = useState<{ id: string; label: string }[] | null>(null);
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([]);
  const [relatedId, setRelatedId] = useState('');
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsJob = type === 'offer' || type === 'assignment';

  useEffect(() => {
    setOptions(null); setRelatedId('');
    fetch(`/api/records/${relatedType === 'candidate' ? 'candidates' : `${relatedType}s`}`).then((r) => (r.ok ? r.json() : [])).then((o) => { setOptions(o); setRelatedId(o[0]?.id ?? ''); });
  }, [relatedType]);
  useEffect(() => { if (needsJob) fetch('/api/records/jobs').then((r) => (r.ok ? r.json() : [])).then(setJobs); }, [needsJob]);

  async function create() {
    if (!relatedId) return setError(`Add a ${relatedType} first.`);
    setBusy(true); setError('');
    try {
      const { document } = await api('/api/esign', 'POST', { type, relatedType, relatedId, jobId: jobId || undefined });
      router.refresh(); onCreated(document.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title={DOC_TYPES[type]} kicker="New document" onClose={onClose} footer={<><button className="btn" onClick={create} disabled={busy || !options}>{busy ? 'Creating…' : 'Create draft'}</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <p className="muted">The draft is filled in from the record you pick. You can edit it before sending.</p>
      {type === 'custom' && <label>For<select value={relatedType} onChange={(e) => setRelatedType(e.target.value as typeof relatedType)}><option value="candidate">Candidate</option><option value="vendor">Vendor</option><option value="client">Client</option></select></label>}
      <label>{relatedType[0].toUpperCase() + relatedType.slice(1)}<select value={relatedId} onChange={(e) => setRelatedId(e.target.value)} disabled={!options}>
        {!options ? <option>Loading…</option> : options.length ? options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>) : <option value="">None yet</option>}
      </select></label>
      {needsJob && <label>Job<select value={jobId} onChange={(e) => setJobId(e.target.value)}><option value="">— Choose a job —</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label>}
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function DocumentDrawer({ id, canEdit, admin, onClose }: { id: string; canEdit: boolean; admin: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [edit, setEdit] = useState<Pick<Doc, 'title' | 'body' | 'signerName' | 'signerEmail'> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [counterName, setCounterName] = useState('');
  const [consent, setConsent] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);

  async function load() {
    try { const { document } = await api(`/api/esign/${id}`, 'GET'); setDoc(document); setEdit({ title: document.title, body: document.body, signerName: document.signerName, signerEmail: document.signerEmail }); }
    catch (e) { toast((e as Error).message, true); onClose(); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  const draft = doc?.status === 'DRAFT' && canEdit;
  const dirty = !!(doc && edit && (edit.title !== doc.title || edit.body !== doc.body || edit.signerName !== doc.signerName || edit.signerEmail !== doc.signerEmail));
  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label); setError('');
    try { await fn(); toast(done); await load(); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const save = () => run('save', () => api(`/api/esign/${id}`, 'PATCH', edit), 'Saved.');
  const send = () => run('send', async () => { if (dirty) await api(`/api/esign/${id}`, 'PATCH', edit); await api(`/api/esign/${id}/send`, 'POST'); }, 'Sent for signature.');
  const voidDoc = () => { if (confirm('Void this document? Its signing link will stop working.')) run('void', () => api(`/api/esign/${id}`, 'PATCH', { action: 'void' }), 'Voided.'); };
  const countersign = () => {
    if (counterName.trim().length < 2) return setError('Type your full name.');
    if (!pad.current || pad.current.isEmpty()) return setError('Draw your signature in the box.');
    if (!consent) return setError('Check the box to agree to sign electronically.');
    run('counter', () => api(`/api/esign/${id}/countersign`, 'POST', { name: counterName, signature: pad.current!.toDataURL(), consent: true }), 'Countersigned. The signer has been emailed a copy.');
  };

  return (
    <Drawer title={doc?.title ?? 'Loading…'} kicker={doc ? STATUS[doc.status] : 'Document'} onClose={onClose} footer={doc && canEdit ? <>
      {doc.status === 'DRAFT' && <><button className="btn" onClick={send} disabled={!!busy}>{busy === 'send' ? 'Sending…' : 'Send for signature'}</button>
        <button className="btn ghost" onClick={save} disabled={!dirty || !!busy}>Save draft</button></>}
      {doc.status === 'SENT' && <button className="btn" onClick={send} disabled={!!busy}>{busy === 'send' ? 'Sending…' : 'Resend link'}</button>}
      {doc.pdfFileId && <a className="btn ghost" href={`/api/esign/${id}/pdf`}>Download PDF</a>}
      <span style={{ flex: 1 }} />
      {(doc.status === 'DRAFT' || doc.status === 'SENT') && <button className="btn danger" onClick={voidDoc} disabled={!!busy}>Void</button>}
    </> : doc?.pdfFileId ? <a className="btn ghost" href={`/api/esign/${id}/pdf`}>Download PDF</a> : undefined}>
      {!doc || !edit ? <p className="muted">Loading…</p> : <>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form">
          <label className="full"><span>Title</span><input value={edit.title} readOnly={!draft} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
          <label><span>Signer name</span><input value={edit.signerName} readOnly={!draft} onChange={(e) => setEdit({ ...edit, signerName: e.target.value })} /></label>
          <label><span>Signer email</span><input type="email" value={edit.signerEmail} readOnly={!draft} onChange={(e) => setEdit({ ...edit, signerEmail: e.target.value })} /></label>
          {draft
            ? <label className="full"><span>Document text — fill in anything in [brackets] or {'{{braces}}'} before sending</span><textarea rows={16} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
            : <div className="full"><p className="muted" style={{ margin: '10px 0 4px' }}>Document text{doc.bodySha256 ? ' (locked)' : ''}</p><article className="doc docview">{doc.body}</article></div>}
        </div>
        {doc.status === 'SENT' && doc.tokenExpiresAt && <p className="muted">Waiting for {doc.signerName} to sign. The link expires {date(doc.tokenExpiresAt)}.</p>}
        {doc.signerSignature && (
          <section className="sec"><h3>Signatures</h3>
            {/* Signatures are inline PNG data URLs, which next/image doesn't optimize. */}
            {/* eslint-disable @next/next/no-img-element */}
            <div className="sigs">
              <figure><img src={doc.signerSignature} alt={`Signature of ${doc.signerName}`} /><figcaption>{doc.signerName}<br /><span className="muted">{doc.signedAt && when(doc.signedAt)}</span></figcaption></figure>
              {doc.counterSignature && <figure><img src={doc.counterSignature} alt={`Signature of ${doc.counterName}`} /><figcaption>{doc.counterName}<br /><span className="muted">{doc.counterSignedAt && when(doc.counterSignedAt)}</span></figcaption></figure>}
            </div>
            {/* eslint-enable @next/next/no-img-element */}
          </section>
        )}
        {doc.status === 'SIGNED' && admin && (
          <section className="sec"><h3>Countersign for your company</h3>
            <label><span>Your full name</span><input value={counterName} onChange={(e) => setCounterName(e.target.value)} /></label>
            <SignaturePad ref={pad} label="Countersignature pad" />
            <button type="button" className="btn ghost sm" onClick={() => pad.current?.clear()}>Clear</button>
            <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree to use electronic records and signatures and intend to sign this document for my company.</label>
            <button className="btn" onClick={countersign} disabled={!!busy}>{busy === 'counter' ? 'Signing…' : 'Countersign'}</button>
          </section>
        )}
        <section className="sec"><h3>Audit trail</h3>
          <ol className="audit">{doc.audit.map((a, i) => <li key={i}><span className="muted">{when(a.at)}</span> {a.event}{a.name ? ` by ${a.name}` : a.by ? ` by ${a.by}` : ''}{a.to ? ` to ${a.to}` : ''}{a.ip ? ` from ${a.ip}` : ''}</li>)}</ol>
          {doc.bodySha256 && <p className="muted" style={{ wordBreak: 'break-all', fontSize: 12 }}>SHA-256 of the locked text: {doc.bodySha256}</p>}
        </section>
      </>}
    </Drawer>
  );
}
