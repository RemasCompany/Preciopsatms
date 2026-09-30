'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';

type Reach = { total: number; email: number; sms: number };
type Progress = { status: string; sent: number; skipped: number; failed: number; total: number; error: string | null; retrying?: boolean };
const FIELDS = ['first_name', 'company', 'job_title', 'job_location', 'pay_rate', 'my_short', 'owner', 'signature'];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Message this list": one merged email or text per person (never a BCC blast). Large lists send in the background. */
export default function BulkMessage({ type, noun, ids, reach }: { type: 'candidate' | 'lead' | 'vendor' | 'contact'; noun: string; ids: string[]; reach: Reach }) {
  const [open, setOpen] = useState(false);
  if (!ids.length) return null;
  return (
    <>
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Message this list</button>
      {open && <BulkDrawer type={type} noun={noun} ids={ids} reach={reach} onClose={() => setOpen(false)} />}
    </>
  );
}

function BulkDrawer({ type, noun, ids, reach, onClose }: { type: 'candidate' | 'lead' | 'vendor' | 'contact'; noun: string; ids: string[]; reach: Reach; onClose: () => void }) {
  const { toast } = useRecords();
  const router = useRouter();
  const [channel, setChannel] = useState<'email' | 'sms'>(reach.email || !reach.sms ? 'email' : 'sms');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('Hi {{first_name}},\n\n\n\n{{signature}}');
  const [jobId, setJobId] = useState('');
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { if (type === 'candidate') fetch('/api/records/jobs').then((r) => (r.ok ? r.json() : [])).then(setJobs); }, [type]);

  const reachable = channel === 'email' ? reach.email : reach.sms;
  const finish = (p: { sent: number; skipped: number; failed: number }) => {
    toast(`Sent ${p.sent}${p.skipped ? `, skipped ${p.skipped} (no ${channel === 'email' ? 'email' : 'phone'} or opted out)` : ''}${p.failed ? `, ${p.failed} failed — see each record’s messages` : ''}.`, !p.sent);
    router.refresh(); onClose();
  };

  async function follow(taskId: string) {
    fetch(`/api/tasks/${taskId}/run`, { method: 'POST' }).catch(() => {}); // runs in its own request; we just watch
    for (;;) {
      await wait(1500);
      if (!alive.current) return;
      const r = await fetch(`/api/tasks/${taskId}`);
      if (!r.ok) continue;
      const p: Progress = await r.json();
      setProgress(p);
      if (p.status === 'done') return finish(p);
      if (p.status === 'failed') { setBusy(false); return setError(`Sending stopped: ${p.error ?? 'unknown error'}. ${p.sent} were sent before it stopped.`); }
    }
  }

  async function send() {
    if (channel === 'email' && !subject.trim()) return setError('Add a subject.');
    if (!body.trim()) return setError('Write a message.');
    setBusy(true); setError('');
    const r = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, recipientType: type, recipientIds: ids, subject: channel === 'email' ? subject : undefined, body, jobId: jobId || undefined }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); return setError(j.error ?? 'Could not send.'); }
    if (j.queued) { setProgress({ status: 'queued', sent: 0, skipped: 0, failed: 0, total: j.total, error: null }); return follow(j.taskId); }
    finish(j);
  }

  const done = progress ? progress.sent + progress.skipped + progress.failed : 0;
  return (
    <Drawer title={`${ids.length} ${noun}`} kicker="Message this list" onClose={onClose}
      footer={<><button className="btn" onClick={send} disabled={busy || !reachable}>{busy ? 'Sending…' : `Send ${reachable} ${channel === 'email' ? 'email' : 'text'}${reachable === 1 ? '' : 's'}`}</button><button className="btn ghost" onClick={onClose}>{progress ? 'Close (keeps sending)' : 'Cancel'}</button></>}>
      {progress ? (
        <div role="status">
          <p><b>Sending {done} of {progress.total}…</b>{progress.retrying ? ' (retrying after a hiccup)' : ''}</p>
          <progress max={progress.total} value={done} style={{ width: '100%' }} />
          <p className="muted">{progress.sent} sent · {progress.skipped} skipped · {progress.failed} failed. You can close this — it keeps going, and every message is logged on the person’s record.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      ) : (
        <>
          <div className="row" style={{ marginTop: 0 }} role="radiogroup" aria-label="Channel">
            {(['email', 'sms'] as const).map((c) => (
              <label key={c} className="check" style={{ margin: 0 }}><input type="radio" name="bulkchannel" checked={channel === c} onChange={() => setChannel(c)} /> {c === 'email' ? 'Email' : 'Text'}</label>
            ))}
          </div>
          <p className={reachable ? 'muted' : 'warn'}>
            {reachable} of {ids.length} can get {channel === 'email' ? 'email' : 'texts'}{ids.length - reachable ? `; ${ids.length - reachable} will be skipped (no ${channel === 'email' ? 'email address' : 'phone number'}, or opted out)` : ''}.
            {' '}Each person gets their own message — nobody sees the others.{ids.length > 25 ? ' Large lists send in the background.' : ''}
          </p>
          {channel === 'email' && <label><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>}
          {jobs.length > 0 && <label><span>About a job (fills {'{{job_title}}'}, {'{{job_location}}'}, {'{{pay_rate}}'})</span><select value={jobId} onChange={(e) => setJobId(e.target.value)}><option value="">— None —</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label>}
          <label><span>Message</span><textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <p className="muted" style={{ fontSize: 13 }}>Merge fields: {FIELDS.map((f) => `{{${f}}}`).join(' ')}{channel === 'sms' ? ' · “Reply STOP to opt out” is added automatically.' : ''} A message that would leave a {'{{field}}'} blank isn’t sent to that person.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </>
      )}
    </Drawer>
  );
}
