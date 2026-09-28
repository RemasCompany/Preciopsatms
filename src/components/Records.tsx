'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Stage } from '@prisma/client';
import Drawer from './Drawer';
import { ComposeDrawer, MessageHistory, type Recipient, type SentMessage } from './Compose';
import RecordForm, { invalidateRefs } from './RecordForm';
import { RECORDS, defaultsFor, labelFor, vendorCompliance, HOURS_PER_WEEK, type RecordKind, type RecordValues } from '@/lib/records';
import { BOARD_STAGES, REJECTION_REASONS, stageLabel } from '@/lib/pipeline';

type Open = { kind: RecordKind; id?: string; preset?: RecordValues };
type Ctx = { open: (kind: RecordKind, id?: string, preset?: RecordValues) => void; toast: (text: string, error?: boolean) => void; canEdit: boolean; ai: boolean };
const RecordsCtx = createContext<Ctx | null>(null);
export const useRecords = () => {
  const c = useContext(RecordsCtx);
  if (!c) throw new Error('useRecords must be used inside <RecordsProvider>');
  return c;
};

/** Hosts the record drawer and toast for every page under /app. */
export function RecordsProvider({ canEdit, ai, children }: { canEdit: boolean; ai: boolean; children: React.ReactNode }) {
  const [current, setCurrent] = useState<Open | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((text: string, error = false) => {
    setToastMsg({ text, error }); clearTimeout(timer.current); timer.current = setTimeout(() => setToastMsg(null), 3500);
  }, []);
  const open = useCallback((kind: RecordKind, id?: string, preset?: RecordValues) => setCurrent({ kind, id, preset }), []);
  return (
    <RecordsCtx.Provider value={{ open, toast, canEdit, ai }}>
      {children}
      {current && <RecordDrawer key={`${current.kind}:${current.id ?? 'new'}`} {...current} onClose={() => setCurrent(null)} />}
      {toastMsg && <div className={`toast${toastMsg.error ? ' bad' : ''}`} role="status">{toastMsg.text}</div>}
    </RecordsCtx.Provider>
  );
}

/** A button that opens a record's drawer. Use inside server-rendered lists. */
export function OpenRecord({ kind, id, preset, className, children }: { kind: RecordKind; id?: string; preset?: RecordValues; className?: string; children: React.ReactNode }) {
  const { open } = useRecords();
  return <button type="button" className={className ?? 'link'} onClick={() => open(kind, id, preset)}>{children}</button>;
}

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

const money = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }));

type Extras = Record<string, unknown>;

function RecordDrawer({ kind, id, preset, onClose }: Open & { onClose: () => void }) {
  const router = useRouter();
  const { open, toast, canEdit } = useRecords();
  const spec = RECORDS[kind];
  const [values, setValues] = useState<RecordValues | null>(id ? null : defaultsFor(kind, preset));
  const [extras, setExtras] = useState<Extras>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try { const d = await api(`/api/records/${kind}/${id}`, 'GET'); setValues(d.record); setExtras(d.extras); }
    catch (e) { toast((e as Error).message, true); onClose(); }
  }, [kind, id, toast, onClose]);
  useEffect(() => { load(); }, [load]);

  const changed = () => { router.refresh(); if (kind === 'clients' || kind === 'vendors') invalidateRefs(kind); };

  async function save() {
    if (!values) return;
    const missing = spec.fields.find((f) => f.required && !String(values[f.key] ?? '').trim());
    if (missing) return setError(`${missing.label} is required.`);
    setBusy(true); setError('');
    try {
      if (id) await api(`/api/records/${kind}/${id}`, 'PATCH', values); else await api(`/api/records/${kind}`, 'POST', values);
      toast(id ? 'Saved.' : 'Added.'); changed(); onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!id || !confirm(`Delete this ${spec.one}? This can’t be undone.`)) return;
    setBusy(true);
    try { await api(`/api/records/${kind}/${id}`, 'DELETE'); toast('Deleted.'); changed(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const title = id ? String(values?.[spec.titleKey] ?? '') || `Untitled ${spec.one}` : `Add ${spec.one}`;
  const kicker = id ? spec.one[0].toUpperCase() + spec.one.slice(1) : `New ${spec.one}`;
  return (
    <Drawer title={values ? title : 'Loading…'} kicker={kicker} onClose={onClose} footer={canEdit && values ? <>
      <button className="btn" onClick={save} disabled={busy}>{id ? 'Save changes' : `Add ${spec.one}`}</button>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <span style={{ flex: 1 }} />
      {id && <button className="btn danger" onClick={remove} disabled={busy}>Delete</button>}
    </> : undefined}>
      {!values ? <p className="muted">Loading…</p> : <>
        {error && <p className="error" role="alert">{error}</p>}
        <RecordForm kind={kind} values={values} onChange={setValues} readOnly={!canEdit} />
        {id && <Extras kind={kind} id={id} values={values} extras={extras} reload={() => { load(); router.refresh(); }} open={open} toast={toast} canEdit={canEdit} />}
      </>}
    </Drawer>
  );
}

function Extras(props: { kind: RecordKind; id: string; values: RecordValues; extras: Extras; reload: () => void; open: Ctx['open']; toast: Ctx['toast']; canEdit: boolean }) {
  const { kind, id, values, extras, reload, canEdit } = props;
  const [to, setTo] = useState<Recipient | null>(null);
  const type = ({ candidates: 'candidate', leads: 'lead', vendors: 'vendor' } as const)[kind as 'candidates' | 'leads' | 'vendors'];
  const optOut = extras.optOut as { email: boolean; sms: boolean } | undefined;
  const self: Recipient | null = type ? {
    type, id, name: String((kind === 'candidates' ? values.name : values.contact) || values.name || values.company || ''),
    email: (values.email as string) || null, phone: (values.phone as string) || null, emailOptOut: optOut?.email, smsOptOut: optOut?.sms,
  } : null;
  return <>
    {self && canEdit && <div className="row"><button className="btn ghost" onClick={() => setTo(self)}>Email / text</button></div>}
    <RelatedExtras {...props} compose={setTo} />
    <MessageHistory messages={(extras.messages ?? []) as SentMessage[]} />
    {to && <ComposeDrawer to={to} onClose={() => setTo(null)} onSent={reload} />}
  </>;
}

function StageSelect({ appId, stage, onMoved, canEdit }: { appId: string; stage: Stage; onMoved: () => void; canEdit: boolean }) {
  const { toast } = useRecords();
  const [pending, setPending] = useState<Stage | null>(null);
  async function move(to: Stage, rejectionReason?: string) {
    try { await api(`/api/applications/${appId}`, 'PATCH', { stage: to, rejectionReason }); setPending(null); onMoved(); if (to === 'PLACED') toast('Placed. Nice work.'); }
    catch (e) { toast((e as Error).message, true); }
  }
  if (pending === 'REJECTED') return (
    <select aria-label="Rejection reason" autoFocus defaultValue="" onChange={(e) => e.target.value && move('REJECTED', e.target.value)} onBlur={() => setPending(null)}>
      <option value="" disabled>Why rejected?</option>
      {REJECTION_REASONS.map((r) => <option key={r}>{r}</option>)}
    </select>
  );
  return (
    <select aria-label="Stage" value={stage} disabled={!canEdit} onChange={(e) => { const s = e.target.value as Stage; if (s === 'REJECTED') setPending(s); else move(s); }}>
      {BOARD_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
    </select>
  );
}

function RelatedExtras({ kind, id, values, extras, reload, open, toast, canEdit, compose }: {
  kind: RecordKind; id: string; values: RecordValues; extras: Extras; reload: () => void; open: Ctx['open']; toast: Ctx['toast']; canEdit: boolean; compose: (r: Recipient) => void;
}) {
  const [pick, setPick] = useState('');
  if (kind === 'candidates') {
    const apps = (extras.applications ?? []) as { id: string; jobId: string; job: string; client: string | null; billRate: number | null; stage: Stage }[];
    const jobs = (extras.openJobs ?? []) as { id: string; label: string }[];
    const submit = async () => {
      if (!pick) return;
      try { await api('/api/applications', 'POST', { jobId: pick, candidateId: id, stage: 'SOURCED' }); setPick(''); toast('Added to pipeline.'); reload(); }
      catch (e) { toast((e as Error).message, true); }
    };
    return (
      <section className="sec"><h3>Submissions <span className="muted">{apps.length}</span></h3>
        <div className="list">
          {apps.map((a) => (
            <div key={a.id} className="li"><button className="link x" onClick={() => open('jobs', a.jobId)}><b>{a.job}</b><span className="muted">{[a.client, a.billRate ? `bill ${money(a.billRate)}/hr` : null].filter(Boolean).join(' · ')}</span></button>
              <StageSelect appId={a.id} stage={a.stage} onMoved={reload} canEdit={canEdit} /></div>
          ))}
          {!apps.length && <p className="muted">Not submitted to any job yet.</p>}
        </div>
        {canEdit && jobs.length > 0 && (
          <div className="row"><select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Job" style={{ flex: 1 }}><option value="">Choose an open job…</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select>
            <button className="btn ghost" onClick={submit} disabled={!pick}>Add to pipeline</button></div>
        )}
      </section>
    );
  }
  if (kind === 'jobs') {
    const pay = Number(values.payRate) || 0, bill = Number(values.billRate) || 0, spread = bill - pay, openings = Number(values.openings) || 1;
    const apps = (extras.applications ?? []) as { id: string; candidateId: string; name: string; title: string | null; stage: Stage; matchScore: number | null }[];
    return <>
      <section className="sec"><h3>Economics</h3>
        <div className="kpis"><div className="kpi"><b>{money(spread)}/hr</b><span>Spread</span></div><div className="kpi"><b>{bill ? `${Math.round((spread / bill) * 100)}%` : '—'}</b><span>Gross margin</span></div>
          <div className="kpi"><b>{money(spread * HOURS_PER_WEEK * openings)}</b><span>Weekly GP if filled</span></div></div></section>
      <section className="sec"><h3>Pipeline <a className="btn ghost sm" href={`/app/pipeline?job=${id}`}>Open board</a></h3>
        <div className="list">
          {apps.map((a) => (
            <div key={a.id} className="li"><button className="link x" onClick={() => open('candidates', a.candidateId)}><b>{a.name}</b><span className="muted">{[a.matchScore ? `Match ${a.matchScore}` : null, a.title].filter(Boolean).join(' · ')}</span></button>
              <StageSelect appId={a.id} stage={a.stage} onMoved={reload} canEdit={canEdit} /></div>
          ))}
          {!apps.length && <p className="muted">No candidates yet.</p>}
        </div></section>
    </>;
  }
  if (kind === 'clients') {
    const contacts = (extras.contacts ?? []) as (RecordValues & { id: string })[];
    const jobs = (extras.jobs ?? []) as { id: string; title: string; location: string | null; status: string }[];
    const deals = (extras.deals ?? []) as { id: string; title: string; value: number | null; stage: string }[];
    return <>
      <Contacts clientId={id} contacts={contacts} reload={reload} canEdit={canEdit} compose={compose} />
      <section className="sec"><h3>Jobs {canEdit && <button className="btn ghost sm" onClick={() => open('jobs', undefined, { clientId: id })}>+ New job</button>}</h3>
        <div className="list">{jobs.map((j) => <button key={j.id} className="li link" onClick={() => open('jobs', j.id)}><span className="x"><b>{j.title}</b><span className="muted">{j.location}</span></span><Pill s={labelFor('jobs', 'status', j.status)} /></button>)}
          {!jobs.length && <p className="muted">No jobs yet.</p>}</div></section>
      <section className="sec"><h3>Deals {canEdit && <button className="btn ghost sm" onClick={() => open('deals', undefined, { clientId: id })}>+ New deal</button>}</h3>
        <div className="list">{deals.map((d) => <button key={d.id} className="li link" onClick={() => open('deals', d.id)}><span className="x"><b>{d.title}</b><span className="muted">{money(d.value)}</span></span><Pill s={d.stage} /></button>)}
          {!deals.length && <p className="muted">No deals yet.</p>}</div></section>
    </>;
  }
  if (kind === 'leads') return <LeadWork id={id} values={values} reload={reload} />;
  if (kind === 'vendors') {
    const issues = vendorCompliance(values as never);
    const cands = (extras.candidates ?? []) as { id: string; name: string; title: string | null; status: string }[];
    return <>
      <section className="sec"><h3>Compliance</h3>
        {issues.length ? issues.map((i) => <div key={i.text} className={i.level}>{i.text}</div>) : <span className="okc">Insurance, W-9 and agreement are all current.</span>}</section>
      <section className="sec"><h3>Candidates supplied <span className="muted">{cands.length}</span></h3>
        <div className="list">{cands.map((c) => <button key={c.id} className="li link" onClick={() => open('candidates', c.id)}><span className="x"><b>{c.name}</b><span className="muted">{c.title}</span></span><Pill s={c.status} /></button>)}
          {!cands.length && <p className="muted">No candidates from this vendor yet. Set “Supplied by vendor” on a candidate.</p>}</div></section>
    </>;
  }
  return null;
}

type LeadAi = { score: number; why: string; nextStep: string; subject: string; body: string };
function LeadWork({ id, values, reload }: { id: string; values: RecordValues; reload: () => void }) {
  const { toast, canEdit, ai } = useRecords();
  const [out, setOut] = useState<LeadAi | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const first = String(values.contact ?? '').trim().split(/\s+/)[0];
  const body = out ? out.body.replace(/\[First name\]/g, first || 'there') : '';
  async function score() {
    setBusy(true); setErr('');
    try { setOut(await api('/api/ai/lead-score', 'POST', { leadId: id })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function saveScore() {
    if (!out) return;
    const patch: RecordValues = { score: out.score };
    if (values.status === 'New' && out.score >= 60) patch.status = 'Qualified';
    try { await api(`/api/records/leads/${id}`, 'PATCH', patch); toast('Score saved.'); reload(); } catch (e) { toast((e as Error).message, true); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(`Subject: ${out!.subject}\n\n${body}`); toast('Email copied.'); }
    catch { toast('Copy isn’t available here. Select the text and copy it instead.', true); }
  }
  async function convert() {
    try { await api(`/api/records/leads/${id}/convert`, 'POST'); toast('Converted. Client and deal created.'); invalidateRefs('clients'); reload(); }
    catch (e) { toast((e as Error).message, true); }
  }
  return (
    <section className="sec"><h3>Work this lead</h3>
      <div className="row">
        {ai && canEdit && <button className="btn ghost" onClick={score} disabled={busy}>{busy ? 'Thinking…' : 'Score & draft outreach'}</button>}
        {values.status === 'Converted' ? <Pill s="Converted" /> : canEdit && <button className="btn" onClick={convert}>Convert to client + deal</button>}
      </div>
      {err && <p className="warn" role="alert">{err}</p>}
      {out && (
        <div className="aiout">
          <div className="row" style={{ marginTop: 0 }}><span className="score" style={{ fontSize: 22, color: 'var(--accent)' }}>{out.score}</span><span>{out.why}</span></div>
          <p><b>Next step:</b> {out.nextStep}</p>
          <p style={{ marginBottom: 4 }}><b>Subject:</b> {out.subject}</p>
          <div style={{ whiteSpace: 'pre-wrap' }}>{body}</div>
          <div className="row">
            {canEdit && <button className="btn sm" onClick={saveScore}>Save score</button>}
            <button className="btn ghost sm" onClick={copy}>Copy email</button>
            {values.email && <a className="btn ghost sm" href={`mailto:${values.email}?subject=${encodeURIComponent(out.subject)}&body=${encodeURIComponent(body)}`}>Open in mail</a>}
          </div>
        </div>
      )}
    </section>
  );
}

function Contacts({ clientId, contacts, reload, canEdit, compose }: { clientId: string; contacts: (RecordValues & { id: string })[]; reload: () => void; canEdit: boolean; compose: (r: Recipient) => void }) {
  const { toast } = useRecords();
  const [draft, setDraft] = useState<RecordValues | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  async function save() {
    if (!draft) return;
    try {
      if (editing) await api(`/api/records/contacts/${editing}`, 'PATCH', draft); else await api('/api/records/contacts', 'POST', { ...draft, clientId });
      setDraft(null); setEditing(null); reload();
    } catch (e) { toast((e as Error).message, true); }
  }
  async function remove(cid: string) {
    if (!confirm('Remove this contact?')) return;
    try { await api(`/api/records/contacts/${cid}`, 'DELETE'); reload(); } catch (e) { toast((e as Error).message, true); }
  }
  return (
    <section className="sec"><h3>Contacts {canEdit && !draft && <button className="btn ghost sm" onClick={() => { setEditing(null); setDraft(defaultsFor('contacts')); }}>+ Add contact</button>}</h3>
      <div className="list">
        {contacts.map((c) => (
          <div key={c.id} className="li"><span className="x"><b>{c.name}</b><span className="muted">{c.title}</span></span>
            <span className="muted">{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>} {c.phone}</span>
            {canEdit && <span className="row"><button className="btn ghost sm" onClick={() => compose({ type: 'contact', id: c.id, name: String(c.name), email: (c.email as string) || null, phone: (c.phone as string) || null })}>Message</button><button className="btn ghost sm" onClick={() => { setEditing(c.id); setDraft(c); }}>Edit</button><button className="btn ghost sm" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}>✕</button></span>}
          </div>
        ))}
        {!contacts.length && !draft && <p className="muted">No contacts yet.</p>}
      </div>
      {draft && <div className="subform"><RecordForm kind="contacts" values={draft} onChange={setDraft} />
        <div className="row"><button className="btn sm" onClick={save}>{editing ? 'Save contact' : 'Add contact'}</button><button className="btn ghost sm" onClick={() => { setDraft(null); setEditing(null); }}>Cancel</button></div></div>}
    </section>
  );
}

const GOOD = ['Signed', 'Paid', 'Open', 'Active', 'Approved', 'Won', 'Placed', 'Converted', 'On assignment', 'Compliant'];
const AMBER = ['Draft', 'On hold', 'Pending', 'Prospect', 'Contacted', 'Qualified', 'Hot', 'Proposal', 'Negotiation', 'Offer', 'Interview', 'New'];
const RED = ['Void', 'Closed', 'Suspended', 'Lost', 'Disqualified', 'Do not use', 'Rejected'];
export function Pill({ s }: { s: string | null | undefined }) {
  const t = s || '—';
  return <span className={`pill${GOOD.includes(t) ? ' g' : AMBER.includes(t) ? ' a' : RED.includes(t) ? ' r' : ''}`}>{t}</span>;
}
