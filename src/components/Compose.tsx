'use client';
import { useEffect, useState } from 'react';
import Drawer from './Drawer';
import { useRecords } from './Records';

export type Recipient = { type: 'candidate' | 'lead' | 'vendor' | 'contact'; id: string; name: string; email: string | null; phone: string | null; emailOptOut?: boolean; smsOptOut?: boolean; subject?: string; body?: string };
export type SentMessage = { id: string; channel: string; toAddress: string; subject: string | null; body: string; status: string; error: string | null; createdAt: string };

const FIELDS = ['first_name', 'company', 'job_title', 'job_location', 'pay_rate', 'my_short', 'owner', 'signature'];
const STATUS: Record<string, string> = { sent: 'Sent', failed: 'Failed', blocked_opt_out: 'Opted out', queued: 'Queued' };

/** Write one email or text; it's merged and sent individually to each recipient, and logged. */
export function ComposeDrawer({ to, onClose, onSent }: { to: Recipient; onClose: () => void; onSent: () => void }) {
  const { toast } = useRecords();
  const [channel, setChannel] = useState<'email' | 'sms'>(to.email || !to.phone ? 'email' : 'sms');
  const [subject, setSubject] = useState(to.subject ?? '');
  const [body, setBody] = useState(to.body ?? 'Hi {{first_name}},\n\n\n\n{{signature}}');
  const [jobId, setJobId] = useState('');
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (to.type === 'candidate') fetch('/api/records/jobs').then((r) => (r.ok ? r.json() : [])).then(setJobs); }, [to.type]);

  const address = channel === 'email' ? to.email : to.phone;
  const optedOut = channel === 'email' ? to.emailOptOut : to.smsOptOut;
  async function send() {
    if (channel === 'email' && !subject.trim()) return setError('Add a subject.');
    if (!body.trim()) return setError('Write a message.');
    setBusy(true); setError('');
    const res = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, recipientType: to.type, recipientIds: [to.id], subject: channel === 'email' ? subject : undefined, body, jobId: jobId || undefined }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? 'Could not send.');
    if (j.sent) { toast(channel === 'email' ? 'Email sent.' : 'Text sent.'); onSent(); onClose(); }
    else setError(j.failed ? 'The message couldn’t be delivered. It’s logged below with the reason.' : optedOut ? `${to.name} has opted out of ${channel === 'email' ? 'email' : 'texts'}.` : `No ${channel === 'email' ? 'email address' : 'phone number'} on file.`);
    if (!j.sent) onSent();
  }

  return (
    <Drawer title={`Message ${to.name}`} kicker={channel === 'email' ? 'Email' : 'Text message'} onClose={onClose}
      footer={<><button className="btn" onClick={send} disabled={busy || !address || optedOut}>{busy ? 'Sending…' : channel === 'email' ? 'Send email' : 'Send text'}</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <div className="row" style={{ marginTop: 0 }} role="radiogroup" aria-label="Channel">
        {(['email', 'sms'] as const).map((c) => (
          <label key={c} className="check" style={{ margin: 0 }}><input type="radio" name="channel" checked={channel === c} onChange={() => setChannel(c)} /> {c === 'email' ? 'Email' : 'Text'}</label>
        ))}
      </div>
      <p className={address && !optedOut ? 'muted' : 'warn'}>
        {!address ? `No ${channel === 'email' ? 'email address' : 'phone number'} on file.` : optedOut ? `${to.name} has opted out of ${channel === 'email' ? 'email' : 'texts'}.` : `To ${address}`}
      </p>
      {channel === 'email' && <label><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>}
      {jobs.length > 0 && <label><span>About a job (fills {'{{job_title}}'}, {'{{job_location}}'}, {'{{pay_rate}}'})</span><select value={jobId} onChange={(e) => setJobId(e.target.value)}><option value="">— None —</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label>}
      <label><span>Message</span><textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <p className="muted" style={{ fontSize: 13 }}>Merge fields: {FIELDS.map((f) => `{{${f}}}`).join(' ')}{channel === 'sms' ? ' · “Reply STOP to opt out” is added automatically.' : ''}</p>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

export function MessageHistory({ messages }: { messages: SentMessage[] }) {
  if (!messages.length) return null;
  return (
    <section className="sec"><h3>Messages <span className="muted">{messages.length}</span></h3>
      <div className="list">{messages.map((m) => (
        <details key={m.id} className="li msg">
          <summary><span className="x"><b>{m.channel === 'email' ? m.subject ?? '(no subject)' : m.body.slice(0, 60)}</b>
            <span className="muted">{m.channel === 'email' ? 'Email' : 'Text'} to {m.toAddress} · {new Date(m.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span></span>
            <span className={`pill${m.status === 'sent' ? ' g' : ' r'}`}>{STATUS[m.status] ?? m.status}</span></summary>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, marginTop: 8 }}>{m.body}</div>
          {m.error && <p className="warn">{m.error}</p>}
        </details>
      ))}</div>
    </section>
  );
}
