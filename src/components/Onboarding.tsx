'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { STAFF_TASKS, STEP_KINDS, type StepDef } from '@/lib/onboarding';

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}
const fmt = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : undefined });

export function StartOnboarding({ packages, eligible, hidden = 0 }: { packages: { id: string; name: string }[]; eligible: { id: string; label: string; startDate: string; packageId: string | null }[]; hidden?: number }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [app, setApp] = useState(eligible[0]?.id ?? '');
  const [pkg, setPkg] = useState(eligible[0]?.packageId ?? packages[0]?.id ?? '');
  const [start, setStart] = useState(eligible[0]?.startDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!packages.length || !eligible.length) return null;
  async function go() {
    setBusy(true); setError('');
    try { const r = await api('/api/onboarding', 'POST', { applicationId: app, packageId: pkg, startDate: start || null }); toast('Onboarding started. Send the new hire their link.'); router.push(`/app/onboarding/${r.id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Start onboarding</h2>
      <div className="form payform">
        <label><span>New hire</span><select value={app} onChange={(e) => { const x = eligible.find((y) => y.id === e.target.value); setApp(e.target.value); setStart(x?.startDate ?? ''); if (x?.packageId) setPkg(x.packageId); }}>{eligible.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <label><span>Package</span><select value={pkg} onChange={(e) => setPkg(e.target.value)}>{packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span>First day of work</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>
      {eligible.find((x) => x.id === app)?.packageId && <p className="muted" style={{ fontSize: 13 }}>This client always uses this package.</p>}
      {hidden > 0 && <p className="muted" style={{ fontSize: 13 }}>{hidden} hire{hidden === 1 ? '' : 's'} at clients that don’t require onboarding aren’t listed.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" onClick={go} disabled={busy || !app || !pkg}>{busy ? 'Starting…' : 'Start onboarding'}</button>
    </div>
  );
}

type Step = {
  id: string; kind: string; label: string; hint: string | null; required: boolean; status: 'PENDING' | 'DONE' | 'WAIVED'; auto: boolean;
  task: string | null; credentialType: string | null; completedAt: string | null; byWorker: boolean; note: string | null; hasFile: boolean;
  contact: Record<string, string> | null; doc: { id: string; status: string; blanks: boolean } | null;
};
type Ob = {
  id: string; status: 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED'; packageName: string; startDate: string | null; invitedAt: string | null; completedAt: string | null;
  candidateId: string; name: string; job: string; canText: boolean; canEmail: boolean; done: number; total: number; ready: boolean; i9Due: string | null;
};

export function OnboardingDetail({ ob, steps, canEdit }: { ob: Ob; steps: Step[]; canEdit: boolean }) {
  const router = useRouter();
  const { toast, open } = useRecords();
  const [busy, setBusy] = useState(false);
  const [noteFor, setNoteFor] = useState<{ step: Step; action: 'done' | 'waive' | 'reopen' } | null>(null);
  const [note, setNote] = useState('');
  const [inviting, setInviting] = useState(false);
  const [start, setStart] = useState(ob.startDate ?? '');
  const live = ob.status !== 'CANCELLED';
  const today = new Date().toISOString().slice(0, 10);

  async function act(step: Step, action: 'done' | 'waive' | 'reopen', n?: string) {
    setBusy(true);
    try {
      const r = await api(`/api/onboarding/steps/${step.id}`, 'PATCH', { action, note: n || undefined });
      setNoteFor(null); setNote('');
      toast(r.ready ? `${ob.name} is ready to start.` : action === 'done' ? 'Marked done.' : action === 'waive' ? 'Marked not needed.' : 'Reopened.');
      router.refresh();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!confirm(`Cancel ${ob.name}’s onboarding? Unsigned documents are voided.`)) return;
    try { await api(`/api/onboarding/${ob.id}`, 'PATCH', { action: 'cancel' }); toast('Onboarding cancelled.'); router.refresh(); } catch (e) { toast((e as Error).message, true); }
  }
  async function saveStart() {
    try { await api(`/api/onboarding/${ob.id}`, 'PATCH', { action: 'startDate', startDate: start || null }); toast('Start date saved.'); router.refresh(); } catch (e) { toast((e as Error).message, true); }
  }
  const pill = (s: Step) => s.status === 'WAIVED' ? <span className="pill">Not needed</span>
    : s.status === 'DONE' || s.auto ? <span className="pill g">Done</span>
    : s.kind === 'STAFF' && s.task === 'i9' && ob.i9Due ? <span className={`pill ${ob.i9Due < today ? 'r' : 'a'}`}>{ob.i9Due < today ? `Overdue since ${fmt(ob.i9Due)}` : `Due ${fmt(ob.i9Due)}`}</span>
    : <span className="pill a">{s.kind === 'STAFF' || s.kind === 'CREDENTIAL' ? 'To do (staff)' : 'Waiting on new hire'}</span>;

  return (
    <>
      <div className="runhead">
        <div>
          <h1 style={{ marginBottom: 2 }}>{ob.name} <span className={`pill ${ob.status === 'COMPLETE' ? 'g' : ob.status === 'CANCELLED' ? 'r' : 'a'}`}>{ob.status === 'COMPLETE' ? 'Ready to start' : ob.status === 'CANCELLED' ? 'Cancelled' : `${ob.done} of ${ob.total} done`}</span></h1>
          <p className="muted" style={{ margin: 0 }}>{ob.job} · {ob.packageName}{ob.invitedAt ? ` · link sent ${fmt(ob.invitedAt)}` : ''}{ob.completedAt ? ` · finished ${fmt(ob.completedAt)}` : ''}</p>
        </div>
        {canEdit && live && (
          <div className="row" style={{ marginTop: 0 }}>
            <button className="btn" onClick={() => setInviting(true)}>{ob.invitedAt ? 'Resend link' : 'Send onboarding link'}</button>
            <button className="btn ghost" onClick={() => open('candidates', ob.candidateId)}>Candidate record</button>
            <button className="btn danger" onClick={cancel}>Cancel</button>
          </div>
        )}
      </div>
      {canEdit && live && (
        <div className="bar">
          <label className="row" style={{ margin: 0 }}><span>First day of work</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <button className="btn ghost sm" onClick={saveStart} disabled={start === (ob.startDate ?? '')}>Save date</button>
          {!ob.startDate && <span className="muted">Add the start date to track the I-9 deadline.</span>}
        </div>
      )}
      <div className="list obsteps">
        {steps.map((s) => (
          <div key={s.id} className="li">
            <div className="x">
              <b>{s.label} {!s.required && <span className="muted">(optional)</span>} {pill(s)}</b>
              <span className="muted">{STEP_KINDS[s.kind as keyof typeof STEP_KINDS]}{s.kind === 'CREDENTIAL' && s.credentialType ? `: ${s.credentialType} — done automatically once it’s verified on the candidate’s record` : ''}{s.hint ? ` · ${s.hint}` : ''}</span>
              {s.doc?.blanks && live && <span className="warn">This document has blanks to fill in (e.g. start date or pay rate). Edit it in E-signatures before the new hire can sign.</span>}
              {s.contact && <span>Emergency contact: {s.contact.name} ({s.contact.relationship}), {s.contact.phone}</span>}
              {s.completedAt && <span className="muted">{s.status === 'WAIVED' ? 'Waived' : 'Done'} {fmt(s.completedAt)}{s.byWorker ? ' by the new hire' : ''}{s.note ? ` — “${s.note}”` : ''}</span>}
              <div className="row" style={{ marginTop: 4 }}>
                {s.doc && <a className="btn ghost sm" href={s.doc.status === 'SIGNED' ? `/api/esign/${s.doc.id}/pdf` : '/app/documents'}>{s.doc.status === 'SIGNED' ? 'Signed PDF' : 'Open in E-signatures'}</a>}
                {s.hasFile && <a className="btn ghost sm" href={`/api/onboarding/steps/${s.id}/file`}>Download upload</a>}
                {canEdit && live && s.status === 'PENDING' && !s.auto && s.kind === 'STAFF' && <button className="btn sm" disabled={busy} onClick={() => act(s, 'done')}>Mark done</button>}
                {canEdit && live && s.status === 'PENDING' && !s.auto && s.kind !== 'STAFF' && s.kind !== 'CREDENTIAL' && <button className="btn ghost sm" onClick={() => { setNote(''); setNoteFor({ step: s, action: 'done' }); }}>Mark done…</button>}
                {canEdit && live && s.status === 'PENDING' && !s.auto && <button className="btn ghost sm" onClick={() => { setNote(''); setNoteFor({ step: s, action: 'waive' }); }}>Not needed…</button>}
                {canEdit && live && s.status !== 'PENDING' && !(s.kind === 'SIGN' && s.byWorker) && <button className="btn ghost sm" disabled={busy} onClick={() => act(s, 'reopen')}>Reopen</button>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {noteFor && (
        <Drawer title={noteFor.action === 'waive' ? 'Mark as not needed' : 'Mark done'} kicker={noteFor.step.label} onClose={() => setNoteFor(null)}
          footer={<><button className="btn" disabled={busy || !note.trim()} onClick={() => act(noteFor.step, noteFor.action, note)}>Save</button><button className="btn ghost" onClick={() => setNoteFor(null)}>Cancel</button></>}>
          <label><span>{noteFor.action === 'waive' ? 'Why doesn’t this apply?' : 'How was it done?'}</span><input value={note} maxLength={300} autoFocus placeholder={noteFor.action === 'waive' ? 'e.g. Client doesn’t require a drug screen' : 'e.g. Signed a paper copy on site'} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="muted" style={{ fontSize: 13 }}>The note is kept with the step and in the activity log.</p>
        </Drawer>
      )}
      {inviting && <InviteDrawer ob={ob} onClose={() => setInviting(false)} onSent={() => router.refresh()} />}
    </>
  );
}

function InviteDrawer({ ob, onClose, onSent }: { ob: Ob; onClose: () => void; onSent: () => void }) {
  const { toast } = useRecords();
  const [sms, setSms] = useState(ob.canText);
  const [email, setEmail] = useState(ob.canEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    setBusy(true); setError('');
    try {
      const r = await api(`/api/onboarding/${ob.id}/invite`, 'POST', { channels: [sms && 'sms', email && 'email'].filter(Boolean) });
      if (r.sent.length) { toast(`Onboarding link sent by ${r.sent.map((c: string) => (c === 'sms' ? 'text' : 'email')).join(' and ')}.`); onSent(); onClose(); }
      else setError(r.problems.join(' ') || 'It couldn’t be sent.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Send onboarding link" kicker={ob.name} onClose={onClose} footer={<><button className="btn" onClick={send} disabled={busy || (!sms && !email)}>{busy ? 'Sending…' : 'Send'}</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <p>{ob.name.split(' ')[0]} gets a private link to sign their documents, add an emergency contact and upload what’s asked for. It works for 45 days and also shows their shifts and time clock.</p>
      <div className="row" role="group" aria-label="Send by">
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={sms} disabled={!ob.canText} onChange={(e) => setSms(e.target.checked)} /> Text message{!ob.canText && ' (no mobile number or opted out)'}</label>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={email} disabled={!ob.canEmail} onChange={(e) => setEmail(e.target.checked)} /> Email{!ob.canEmail && ' (no email or opted out)'}</label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

export function AddStarter({ index, name }: { index: number; name: string }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try { await api('/api/onboarding/packages', 'POST', { starter: index }); toast(`Added “${name}”. Review its documents before using it.`); router.refresh(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return <button className="btn ghost" onClick={add} disabled={busy}>+ {name} (starter)</button>;
}

const blankStep = (kind: StepDef['kind']): StepDef => ({
  SIGN: { kind: 'SIGN', label: 'Sign a document', doc: 'custom', title: 'Policy acknowledgment', body: '{{date}}\n\nI acknowledge that I received and read {{my_company}}’s policy on …', required: true },
  UPLOAD: { kind: 'UPLOAD', label: 'Upload a file', required: true },
  FORM: { kind: 'FORM', label: 'Add an emergency contact', form: 'emergency_contact', required: true },
  STAFF: { kind: 'STAFF', label: STAFF_TASKS.i9, task: 'i9', required: true },
  CREDENTIAL: { kind: 'CREDENTIAL', label: 'License verified', credentialType: 'RN license', required: true },
} as Record<string, StepDef>)[kind];

export function PackageEditor({ pkg, credentialTypes }: { pkg?: { id: string; name: string; description: string | null; steps: StepDef[] }; credentialTypes: string[] }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [openEd, setOpenEd] = useState(false);
  const [name, setName] = useState(pkg?.name ?? '');
  const [description, setDescription] = useState(pkg?.description ?? '');
  const [steps, setSteps] = useState<StepDef[]>(pkg?.steps ?? [blankStep('SIGN'), blankStep('FORM'), blankStep('STAFF')]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (i: number, patch: Partial<StepDef>) => setSteps(steps.map((s, j) => (j === i ? ({ ...s, ...patch } as StepDef) : s)));
  const move = (i: number, d: -1 | 1) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setSteps(n); };
  async function save() {
    setBusy(true); setError('');
    try {
      await api(pkg ? `/api/onboarding/packages/${pkg.id}` : '/api/onboarding/packages', pkg ? 'PATCH' : 'POST', { name, description: description || null, steps });
      toast('Package saved.'); setOpenEd(false); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function archive() {
    if (!pkg || !confirm(`Archive “${pkg.name}”? New hires already using it aren’t affected.`)) return;
    try { await api(`/api/onboarding/packages/${pkg.id}`, 'DELETE'); toast('Package archived.'); setOpenEd(false); router.refresh(); } catch (e) { toast((e as Error).message, true); }
  }
  return <>
    <button className={pkg ? 'btn ghost sm' : 'btn'} onClick={() => setOpenEd(true)}>{pkg ? 'Edit' : '+ New package'}</button>
    {openEd && (
      <Drawer title={pkg ? 'Edit package' : 'New package'} kicker="Onboarding" onClose={() => setOpenEd(false)} footer={<>
        <button className="btn" onClick={save} disabled={busy}>Save package</button><button className="btn ghost" onClick={() => setOpenEd(false)}>Cancel</button>
        <span style={{ flex: 1 }} />{pkg && <button className="btn danger" onClick={archive}>Archive</button>}</>}>
        <label><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <label><span>Description</span><input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></label>
        <h3 style={{ margin: '14px 0 0', fontSize: 15 }}>Steps</h3>
        {steps.map((s, i) => (
          <div key={i} className="stepedit">
            <div className="form">
              <label className="full"><span>{STEP_KINDS[s.kind]}</span><input value={s.label} maxLength={120} onChange={(e) => set(i, { label: e.target.value })} /></label>
              {s.kind === 'SIGN' && <label><span>Document</span><select value={s.doc} onChange={(e) => set(i, { doc: e.target.value as 'offer' })}><option value="offer">Offer letter (template)</option><option value="assignment">Assignment confirmation (template)</option><option value="custom">Custom text</option></select></label>}
              {s.kind === 'SIGN' && s.doc === 'custom' && <>
                <label><span>Document title</span><input value={s.title ?? ''} maxLength={200} onChange={(e) => set(i, { title: e.target.value })} /></label>
                <label className="full"><span>Text (merge fields: {'{{name}} {{my_company}} {{job_title}} {{start_date}} {{pay_rate}} {{date}}'})</span><textarea rows={6} value={s.body ?? ''} onChange={(e) => set(i, { body: e.target.value })} /></label>
              </>}
              {s.kind === 'STAFF' && <label><span>Task</span><select value={s.task} onChange={(e) => set(i, { task: e.target.value as 'i9' })}>{Object.entries(STAFF_TASKS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
              {(s.kind === 'UPLOAD' || s.kind === 'CREDENTIAL') && (
                <label><span>{s.kind === 'UPLOAD' ? 'File it as a credential (optional)' : 'Credential type'}</span>
                  <select value={s.credentialType ?? ''} onChange={(e) => set(i, { credentialType: e.target.value || null } as Partial<StepDef>)}>
                    {s.kind === 'UPLOAD' && <option value="">— Just keep the file —</option>}
                    {credentialTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></label>
              )}
              <label className="full"><span>Help text (optional)</span><input value={s.hint ?? ''} maxLength={300} onChange={(e) => set(i, { hint: e.target.value || null })} /></label>
              <label className="check full"><input type="checkbox" checked={s.required} onChange={(e) => set(i, { required: e.target.checked })} /> Required before they start</label>
            </div>
            <div className="ctl">
              <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button className="btn ghost sm" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button className="btn ghost sm" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={`Remove ${s.label}`}>✕</button>
            </div>
          </div>
        ))}
        <div className="row">{(Object.keys(STEP_KINDS) as StepDef['kind'][]).map((k) => <button key={k} className="btn ghost sm" onClick={() => setSteps([...steps, blankStep(k)])}>+ {STEP_KINDS[k]}</button>)}</div>
        {error && <p className="error" role="alert">{error}</p>}
      </Drawer>
    )}
  </>;
}

/** Settings & data card: the company decides whether to use onboarding and how strict it is. */
export function OnboardingSettings({ enabled, enforcement, readOnly }: { enabled: boolean; enforcement: string; readOnly: boolean }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [on, setOn] = useState(enabled);
  const [mode, setMode] = useState(enforcement === 'block' ? 'block' : 'warn');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api('/api/onboarding/settings', 'PATCH', { enabled: on, enforcement: mode }); toast(on ? 'Onboarding settings saved.' : 'Onboarding turned off. Your records are kept.'); router.refresh(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const changed = on !== enabled || mode !== (enforcement === 'block' ? 'block' : 'warn');
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>New-hire onboarding</h2>
      <p className="muted" style={{ marginTop: 0 }}>Choose whether your company uses onboarding. Direct-hire and search firms, whose clients onboard the people they hire, can turn it off. Choose per client on the <a href="/app/onboarding/packages">Packages</a> page.</p>
      <label className="check"><input type="checkbox" checked={on} disabled={readOnly} onChange={(e) => setOn(e.target.checked)} /> Use onboarding for new hires</label>
      {on && (
        <fieldset className="days" style={{ flexDirection: 'column', gap: 6 }}><legend>When a new hire hasn’t finished onboarding</legend>
          <label className="check"><input type="radio" name="enf" checked={mode === 'warn'} disabled={readOnly} onChange={() => setMode('warn')} /> Warn when they’re placed or scheduled (recommended)</label>
          <label className="check"><input type="radio" name="enf" checked={mode === 'block'} disabled={readOnly} onChange={() => setMode('block')} /> Block scheduling and clock-in until every required step is done</label>
        </fieldset>
      )}
      {!readOnly && <button className="btn ghost" onClick={save} disabled={busy || !changed}>Save</button>}
    </section>
  );
}

/** Per client: recruiter chooses, always one package, or not required. */
export function ClientDefaults({ clients, packages }: { clients: { id: string; name: string; mode: string; packageId: string | null }[]; packages: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [busy, setBusy] = useState<string | null>(null);
  async function set(clientId: string, value: string) {
    const [mode, packageId] = value.startsWith('pkg:') ? ['package', value.slice(4)] : [value, null];
    setBusy(clientId);
    try { await api('/api/onboarding/client-defaults', 'PATCH', { clientId, mode, packageId }); toast('Saved.'); router.refresh(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  }
  if (!clients.length) return null;
  return (
    <section className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>By client</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Pick what each client needs. “Not required” hides that client’s hires from Start onboarding; a set package is chosen for recruiters automatically.</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Client</th><th>Onboarding</th></tr></thead>
        <tbody>{clients.map((c) => (
          <tr key={c.id}><td><b>{c.name}</b></td><td>
            <select aria-label={`Onboarding for ${c.name}`} disabled={busy === c.id} value={c.mode === 'package' && c.packageId ? `pkg:${c.packageId}` : c.mode === 'none' ? 'none' : 'ask'} onChange={(e) => set(c.id, e.target.value)}>
              <option value="ask">Recruiter chooses each time</option>
              {packages.map((p) => <option key={p.id} value={`pkg:${p.id}`}>Always use “{p.name}”</option>)}
              <option value="none">Not required for this client</option>
            </select>
          </td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}
