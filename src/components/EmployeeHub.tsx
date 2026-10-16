'use client';
import { useEffect, useRef, useState } from 'react';

/** The employee's own profile, tasks, internal jobs and training sign-up, on their private page. */
export type HubProfile = {
  preferredName: string | null; pronouns: string | null; homeAddress: string | null; emergencyName: string | null; emergencyRelation: string | null; emergencyPhone: string | null;
  bio: string | null; skills: string[]; certs: string[]; email: string | null; phone: string | null; photo: boolean;
};
export type HubStep = { key: string; label: string; done: boolean };
export type HubTask = {
  id: string; title: string; details: string | null; dueAt: string | null; priority: string; done: boolean; doneAt: string | null; isNew: boolean; newUpdates: number;
  updates: { id: string; mine: boolean; author: string; body: string; at: string }[];
};
export type HubJob = { id: string; title: string; location: string | null; type: string; payRate: number | null; description: string | null; skills: string[]; startDate: string | null; hot: boolean; applied: boolean; status: string | null };
export type HubCourse = { id: string; title: string; description: string | null; certType: string; lessons: number; needsApproval: boolean; prerequisite: string | null; state: 'requested' | 'taking' | 'certified' | null };
type Send = (body: object, after?: () => void) => Promise<void>;

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const TYPE: Record<string, string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', SEASONAL: 'Seasonal', TEMP: 'Temp', PER_DIEM: 'Per diem', CONTRACT: 'Contract', CONTRACT_TO_HIRE: 'Contract-to-hire', DIRECT_HIRE: 'Direct hire' };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** A square JPEG no larger than 480px. Redrawing it also drops the photo's metadata (such as where it was taken). */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That file isn’t a picture we can read. Try a JPEG or PNG.')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight), out = Math.min(480, side);
    const c = document.createElement('canvas'); c.width = out; c.height = out;
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('Couldn’t prepare that picture.'))), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

export function Avatar({ src, name, size = 64 }: { src: string | null; name: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>;
}

export function ProfileSetup({ steps, onStart }: { steps: HubStep[]; onStart: () => void }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="card setup">
      <h2 style={{ marginTop: 0 }}>Set up your profile</h2>
      <p className="muted" style={{ marginTop: 0 }}>Help your team know you, and make sure we can reach the right person in an emergency. {done} of {steps.length} done.</p>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Profile progress"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul className="steps">{steps.map((s) => <li key={s.key} className={s.done ? 'done' : ''}><span aria-hidden="true">{s.done ? '✓' : '○'}</span> {s.label}{s.done ? <span className="sr-only"> (done)</span> : ''}</li>)}</ul>
      <button className="btn" onClick={onStart}>Finish my profile</button>
    </div>
  );
}

export function ProfileCard({ token, name, profile, editing, setEditing, send, busy, photoV, onPhoto }: {
  token: string; name: string; profile: HubProfile; editing: boolean; setEditing: (on: boolean) => void; send: Send; busy: boolean; photoV: number; onPhoto: (msg: { text: string; bad?: boolean }) => void;
}) {
  const [f, setF] = useState(() => ({
    preferredName: profile.preferredName ?? '', pronouns: profile.pronouns ?? '', email: profile.email ?? '', phone: profile.phone ?? '', homeAddress: profile.homeAddress ?? '',
    emergencyName: profile.emergencyName ?? '', emergencyRelation: profile.emergencyRelation ?? '', emergencyPhone: profile.emergencyPhone ?? '', bio: profile.bio ?? '', skills: profile.skills.join(', '),
  }));
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const photo = profile.photo ? `/api/public/me/${token}/photo?v=${photoV}` : null;

  async function upload(fl: File | undefined) {
    if (!fl) return;
    setUploading(true);
    try {
      const blob = await shrink(fl);
      const r = await fetch(`/api/public/me/${token}/photo`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const j = await r.json().catch(() => ({}));
      onPhoto(r.ok ? { text: j.message } : { text: j.error ?? 'Couldn’t upload that picture.', bad: true });
    } catch (e) { onPhoto({ text: (e as Error).message, bad: true }); } finally { setUploading(false); if (file.current) file.current.value = ''; }
  }
  async function removePhoto() {
    const r = await fetch(`/api/public/me/${token}/photo`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    onPhoto(r.ok ? { text: j.message } : { text: j.error ?? 'Couldn’t remove it.', bad: true });
  }

  return (
    <div className="card" id="profile">
      <h2 style={{ marginTop: 0 }}>Your profile</h2>
      <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <Avatar src={photo} name={profile.preferredName || name} size={72} />
        <div className="row" style={{ gap: 8 }}>
          <input ref={file} id="photo-file" type="file" accept="image/jpeg,image/png,image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
          <label htmlFor="photo-file" className="btn ghost sm" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.current?.click(); } }}>{uploading ? 'Uploading…' : profile.photo ? 'Change picture' : 'Add a picture'}</label>
          {profile.photo && <button className="btn ghost sm" onClick={removePhoto}>Remove</button>}
        </div>
      </div>
      {editing ? (
        <div className="form" style={{ marginTop: 12 }}>
          <label><span>Preferred name</span><input value={f.preferredName} maxLength={60} placeholder={name.split(' ')[0]} onChange={set('preferredName')} /></label>
          <label><span>Pronouns</span><input value={f.pronouns} maxLength={30} placeholder="Optional, e.g. she/her" onChange={set('pronouns')} /></label>
          <label><span>Personal email</span><input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></label>
          <label><span>Mobile phone</span><input type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></label>
          <label className="full"><span>Home address</span><input autoComplete="street-address" value={f.homeAddress} maxLength={300} placeholder="Street, city, state, ZIP" onChange={set('homeAddress')} /></label>
          <p className="full muted" style={{ margin: '6px 0 0' }}><b>Emergency contact</b> — who we call if something happens at work.</p>
          <label><span>Name</span><input value={f.emergencyName} maxLength={100} onChange={set('emergencyName')} /></label>
          <label><span>Relationship</span><input value={f.emergencyRelation} maxLength={40} placeholder="e.g. Spouse, parent" onChange={set('emergencyRelation')} /></label>
          <label><span>Phone</span><input type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} /></label>
          <label className="full"><span>About me</span><textarea rows={3} maxLength={1000} value={f.bio} placeholder="A line or two your coworkers will see" onChange={set('bio')} /></label>
          <label className="full"><span>Skills (comma separated)</span><input value={f.skills} onChange={set('skills')} placeholder="e.g. Forklift, RF scanner, Spanish" /></label>
          <p className="full muted" style={{ fontSize: 13, margin: 0 }}>Your home address and emergency contact are only seen by HR and your manager.</p>
          <div className="row full">
            <button className="btn" disabled={busy} onClick={() => send({ action: 'profile', ...f, skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean) }, () => setEditing(false))}>Save profile</button>
            <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <dl className="facts">
            <dt>Name</dt><dd>{profile.preferredName ? `${profile.preferredName} (${name})` : name}{profile.pronouns ? ` · ${profile.pronouns}` : ''}</dd>
            <dt>Contact</dt><dd>{[profile.email, profile.phone].filter(Boolean).join(' · ') || <span className="muted">None yet</span>}</dd>
            <dt>Home address</dt><dd>{profile.homeAddress ?? <span className="muted">Not added</span>}</dd>
            <dt>Emergency contact</dt><dd>{profile.emergencyName ? `${profile.emergencyName}${profile.emergencyRelation ? ` (${profile.emergencyRelation})` : ''} · ${profile.emergencyPhone ?? 'no phone'}` : <span className="muted">Not added</span>}</dd>
            {profile.bio && <><dt>About me</dt><dd>{profile.bio}</dd></>}
            {profile.skills.length > 0 && <><dt>Skills</dt><dd>{profile.skills.join(', ')}</dd></>}
            {profile.certs.length > 0 && <><dt>Certifications</dt><dd>{profile.certs.join(', ')}</dd></>}
          </dl>
          <button className="btn ghost sm" onClick={() => setEditing(true)}>Edit profile</button>
        </>
      )}
    </div>
  );
}

export function TasksCard({ token, tasks, send, busy }: { token: string; tasks: HubTask[]; send: Send; busy: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);
  const today = new Date().toLocaleDateString('en-CA');
  const todo = tasks.filter((t) => !t.done), done = tasks.filter((t) => t.done);
  const fresh = todo.filter((t) => t.isNew || t.newUpdates).length;
  // Shown: tell the server, so the next visit marks only what's new after this one. The badges stay for this visit.
  const anyNew = tasks.some((t) => t.isNew || t.newUpdates);
  useEffect(() => {
    if (anyNew) fetch(`/api/public/me/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'seenTasks' }) }).catch(() => undefined);
  }, [anyNew, token]);
  const row = (t: HubTask) => {
    const overdue = !t.done && t.dueAt && t.dueAt < today, expanded = open === t.id;
    return (
      <li key={t.id} className="task">
        <div style={{ flex: 1, minWidth: 0 }}>
          <button className="linkish" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : t.id)}>
            <b style={t.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{t.title}</b>
          </button>
          {t.isNew && <span className="pill a" style={{ marginLeft: 6 }}>New</span>}
          {!t.isNew && t.newUpdates > 0 && <span className="pill a" style={{ marginLeft: 6 }}>{t.newUpdates} new update{t.newUpdates === 1 ? '' : 's'}</span>}
          <div className={overdue ? 'warn' : 'muted'}>{t.done ? `Done${t.doneAt ? ` ${fmt(t.doneAt)}` : ''}` : t.dueAt ? `${overdue ? 'Overdue · was due' : 'Due'} ${fmt(t.dueAt)}` : 'No due date'}{t.priority === 'High' && !t.done ? ' · High priority' : ''}{t.updates.length ? ` · ${t.updates.length} update${t.updates.length === 1 ? '' : 's'}` : ''}</div>
          {expanded && (
            <div className="taskbody">
              {t.details && <p style={{ whiteSpace: 'pre-wrap' }}>{t.details}</p>}
              {t.updates.length > 0 && <ul className="thread">{t.updates.map((u) => <li key={u.id} className={u.mine ? 'mine' : ''}><b>{u.author}</b> <span className="muted">{when(u.at)}</span><div style={{ whiteSpace: 'pre-wrap' }}>{u.body}</div></li>)}</ul>}
              <label className="full"><span className="sr-only">Post an update on {t.title}</span>
                <textarea rows={2} maxLength={1000} placeholder="Post an update or ask a question" value={reply[t.id] ?? ''} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} /></label>
              <div className="row">
                <button className="btn ghost sm" disabled={busy || !(reply[t.id] ?? '').trim()} onClick={() => send({ action: 'task', taskId: t.id, update: reply[t.id] }, () => setReply({ ...reply, [t.id]: '' }))}>Send update</button>
                {t.done ? <button className="btn ghost sm" disabled={busy} onClick={() => send({ action: 'task', taskId: t.id, done: false })}>Reopen</button>
                  : <button className="btn sm" disabled={busy} onClick={() => send({ action: 'task', taskId: t.id, done: true, ...((reply[t.id] ?? '').trim() ? { update: reply[t.id] } : {}) }, () => setReply({ ...reply, [t.id]: '' }))}>Mark done</button>}
              </div>
            </div>
          )}
        </div>
        {!expanded && !t.done && <button className="btn ghost sm" disabled={busy} onClick={() => send({ action: 'task', taskId: t.id, done: true })} aria-label={`Mark “${t.title}” done`}>Done</button>}
      </li>
    );
  };
  return (
    <div className="card" id="tasks">
      <h2 style={{ marginTop: 0 }}>Your tasks{fresh ? <span className="pill a" style={{ marginLeft: 8, fontSize: 13, verticalAlign: 'middle' }}>{fresh} new</span> : null}</h2>
      {todo.length ? <ul className="plainlist tasks">{todo.map(row)}</ul> : <p className="muted">Nothing on your list right now.</p>}
      {done.length > 0 && <>
        <button className="linkish muted" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} {done.length} finished</button>
        {showDone && <ul className="plainlist tasks">{done.map(row)}</ul>}
      </>}
    </div>
  );
}

export function JobsCard({ jobs, send, busy }: { jobs: HubJob[]; send: Send; busy: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <div className="card" id="jobs">
      <h2 style={{ marginTop: 0 }}>Jobs inside the company</h2>
      {!jobs.length ? <p className="muted">No openings are posted to employees right now. Check back soon.</p> : <ul className="plainlist">{jobs.map((j) => (
        <li key={j.id} style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <b>{j.title}</b>{j.hot && <span className="pill a" style={{ marginLeft: 6 }}>Hiring now</span>}
            <div className="muted">{[j.location, TYPE[j.type] ?? j.type, j.payRate ? `$${j.payRate.toFixed(2)}/hr` : null, j.startDate ? `starts ${fmt(j.startDate)}` : null].filter(Boolean).join(' · ')}</div>
            {open === j.id && <div className="taskbody">
              {j.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{j.description}</p> : <p className="muted">Ask the hiring team for details.</p>}
              {j.skills.length > 0 && <p className="muted">Skills: {j.skills.join(', ')}</p>}
              {!j.applied && <>
                <label className="full"><span>Why you’d be a good fit (optional)</span><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <p className="muted" style={{ fontSize: 13 }}>We’ll use the profile and work history we already have. Your manager may be told you applied.</p>
                <div className="row"><button className="btn" disabled={busy} onClick={() => send({ action: 'applyJob', jobId: j.id, note: note.trim() || undefined }, () => { setNote(''); setOpen(null); })}>Apply</button><button className="btn ghost" onClick={() => setOpen(null)}>Cancel</button></div>
              </>}
            </div>}
          </div>
          {j.applied ? <span className={`pill ${j.status === 'closed' ? '' : 'g'}`}>{j.status === 'closed' ? 'Not moving forward' : 'Applied'}</span>
            : open !== j.id && <button className="btn ghost sm" onClick={() => { setOpen(j.id); setNote(''); }}>View &amp; apply</button>}
        </li>
      ))}</ul>}
    </div>
  );
}

export function CoursesCard({ courses, send, busy }: { courses: HubCourse[]; send: Send; busy: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <div className="card" id="courses">
      <h2 style={{ marginTop: 0 }}>Training you can sign up for</h2>
      <ul className="plainlist">{courses.map((c) => (
        <li key={c.id} style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <b>{c.title}</b>
            <div className="muted">{c.lessons} lesson{c.lessons === 1 ? '' : 's'} and a short quiz, then a hands-on evaluation · earns {c.certType}{c.needsApproval ? ' · needs your manager’s OK' : ''}</div>
            {open === c.id && <div className="taskbody">
              {c.description && <p>{c.description}</p>}
              {c.prerequisite && <p className="muted">You’ll need a current {c.prerequisite} to be certified.</p>}
              {c.needsApproval && <label className="full"><span>Why you’d like to take it (optional)</span><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
              <div className="row"><button className="btn" disabled={busy} onClick={() => send({ action: 'trainingSignup', courseId: c.id, note: note.trim() || undefined }, () => { setNote(''); setOpen(null); })}>{c.needsApproval ? 'Ask to take it' : 'Sign up'}</button><button className="btn ghost" onClick={() => setOpen(null)}>Cancel</button></div>
            </div>}
          </div>
          {c.state ? <span className={`pill ${c.state === 'requested' ? 'a' : 'g'}`}>{c.state === 'requested' ? 'Waiting for approval' : c.state === 'taking' ? 'In your training list' : 'Certified'}</span>
            : open !== c.id && <button className="btn ghost sm" onClick={() => { setOpen(c.id); setNote(''); }}>{c.needsApproval ? 'Ask to take it' : 'Sign up'}</button>}
        </li>
      ))}</ul>
    </div>
  );
}
