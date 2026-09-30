'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { RATING_LABELS, RECOGNITION_KINDS, type RecognitionKind } from '@/lib/engagement';

export type EngWorker = {
  applicationId: string; candidateId: string; name: string; job: string; canText: boolean; canEmail: boolean;
  birthMonth: number | null; birthDay: number | null; placedOn: string; contacts: { id: string; name: string }[];
  workerAvg: number | null; clientAvg: number | null;
};
type Fb = { id: string; name: string; source: string; rating: number; wouldRehire: boolean | null; comment: string | null; author: string | null; at: string };
type Rec = { id: string; name: string; kind: RecognitionKind; label: string; message: string; at: string; notified: boolean };
type Panel = { type: 'recognize'; w: EngWorker; kind?: RecognitionKind; message?: string } | { type: 'feedback'; w: EngWorker } | { type: 'ask'; w: EngWorker } | { type: 'birthday'; w: EngWorker };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SOURCE = { WORKER: 'Worker', CLIENT: 'Client', STAFF: 'Logged by staff' } as Record<string, string>;
const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

export default function EngagementBoard({ workers, feedback, recognitions, milestones, canEdit, isAdmin, birthdayGreetings }: {
  workers: EngWorker[]; feedback: Fb[]; recognitions: Rec[]; milestones: { applicationId: string; label: string }[]; canEdit: boolean; isAdmin: boolean; birthdayGreetings: boolean;
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [panel, setPanel] = useState<Panel | null>(null);
  const done = (text: string) => { toast(text); setPanel(null); router.refresh(); };

  return (
    <>
      <div className="grid2">
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Recent feedback</h2>
          {feedback.length ? <div className="list">{feedback.map((f) => (
            <div key={f.id} className={`li${f.rating <= 2 || f.wouldRehire === false ? ' fb-low' : ''}`}>
              <div className="x"><b>{f.name} <span className="muted" style={{ fontWeight: 400 }}>· {SOURCE[f.source]}{f.author ? ` (${f.author})` : ''} · {when(f.at)}</span></b>
                {f.comment && <span>“{f.comment}”</span>}{f.wouldRehire === false && <span className="warn">Wouldn’t have them back</span>}</div>
              <span className={`pill ${f.rating <= 2 ? 'r' : f.rating >= 4 ? 'g' : 'a'}`}>{f.rating}/5 {RATING_LABELS[f.rating]}</span>
            </div>
          ))}</div> : <p className="muted" style={{ margin: 0 }}>No feedback yet. Workers are asked every two weeks on their private page; ask a client below.</p>}
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Recognition</h2>
          {recognitions.length ? <div className="list">{recognitions.map((r) => (
            <div key={r.id} className="li"><div className="x"><b>{RECOGNITION_KINDS[r.kind]?.emoji} {r.label} — {r.name}</b><span>{r.message}</span><span className="muted">{when(r.at)}{r.notified ? ' · sent to them' : ''}</span></div></div>
          ))}</div> : <p className="muted" style={{ margin: 0 }}>Nobody recognized yet. A quick thank-you goes a long way.</p>}
        </section>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>People on assignment</h2>
        {workers.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Worker</th><th>Birthday</th><th>Worker pulse</th><th>Client rating</th><th /></tr></thead>
            <tbody>{workers.map((w) => {
              const ms = milestones.find((m) => m.applicationId === w.applicationId);
              return (
                <tr key={w.applicationId}>
                  <td><b>{w.name}</b><div className="muted">{w.job}</div></td>
                  <td>{w.birthMonth && w.birthDay ? `${MONTHS[w.birthMonth - 1]} ${w.birthDay}` : <span className="muted">—</span>}{canEdit && <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setPanel({ type: 'birthday', w })}>{w.birthMonth ? 'Edit' : 'Add'}</button>}</td>
                  <td>{w.workerAvg ?? <span className="muted">—</span>}</td>
                  <td>{w.clientAvg ?? <span className="muted">—</span>}</td>
                  <td>{canEdit && <div className="row" style={{ margin: 0 }}>
                    <button className="btn sm" onClick={() => setPanel(ms ? { type: 'recognize', w, kind: 'milestone', message: `Congratulations on ${ms.label} on assignment! Thank you for your hard work.` } : { type: 'recognize', w })}>{ms ? `🎉 ${ms.label}` : 'Recognize'}</button>
                    <button className="btn ghost sm" disabled={!w.contacts.length} title={w.contacts.length ? undefined : 'The client has no contact with an email'} onClick={() => setPanel({ type: 'ask', w })}>Ask client</button>
                    <button className="btn ghost sm" onClick={() => setPanel({ type: 'feedback', w })}>Log feedback</button>
                  </div>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="empty"><b>No one on assignment</b>Place candidates on contract, temp or per diem jobs to see them here.</div>}
      </section>

      {isAdmin && canEdit && <GreetingsCard on={birthdayGreetings} />}

      {panel?.type === 'recognize' && <RecognizeDrawer w={panel.w} kind={panel.kind} message={panel.message} onClose={() => setPanel(null)} onDone={done} />}
      {panel?.type === 'feedback' && <FeedbackDrawer w={panel.w} onClose={() => setPanel(null)} onDone={done} />}
      {panel?.type === 'ask' && <AskDrawer w={panel.w} onClose={() => setPanel(null)} onDone={done} />}
      {panel?.type === 'birthday' && <BirthdayDrawer w={panel.w} onClose={() => setPanel(null)} onDone={done} />}
    </>
  );
}

function RecognizeDrawer({ w, kind: k0, message: m0, onClose, onDone }: { w: EngWorker; kind?: RecognitionKind; message?: string; onClose: () => void; onDone: (t: string) => void }) {
  const [kind, setKind] = useState<RecognitionKind>(k0 ?? 'above_beyond');
  const [message, setMessage] = useState(m0 ?? '');
  const [visible, setVisible] = useState(true);
  const [sms, setSms] = useState(w.canText);
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    setBusy(true); setError('');
    try {
      const r = await api('/api/engagement/recognitions', 'POST', { candidateId: w.candidateId, applicationId: w.applicationId, kind, message, visibleToWorker: visible, channels: [sms && 'sms', email && 'email'].filter(Boolean) });
      onDone(r.sent.length ? `Recognition sent to ${w.name.split(' ')[0]}.` : r.problems.length ? `Saved, but it couldn’t be sent: ${r.problems.join(' ')}` : 'Recognition saved.');
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <Drawer title="Recognize" kicker={w.name} onClose={onClose} footer={<><button className="btn" onClick={go} disabled={busy}>Save</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <label><span>Type</span><select value={kind} onChange={(e) => setKind(e.target.value as RecognitionKind)}>{Object.entries(RECOGNITION_KINDS).map(([v, x]) => <option key={v} value={v}>{x.emoji} {x.label}</option>)}</select></label>
      <label><span>Message to {w.name.split(' ')[0]}</span><textarea rows={4} maxLength={500} value={message} placeholder="e.g. The charge nurse called to say you handled a tough night shift like a pro. Thank you!" onChange={(e) => setMessage(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show it on their private page</label>
      <div className="row" role="group" aria-label="Send now">
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={sms} disabled={!w.canText} onChange={(e) => setSms(e.target.checked)} /> Text it to them</label>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={email} disabled={!w.canEmail} onChange={(e) => setEmail(e.target.checked)} /> Email it</label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <div className="stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} — ${RATING_LABELS[n]}`} className={n <= value ? 'on' : undefined} onClick={() => onChange(n)}>★</button>)}{value > 0 && <span className="muted">{RATING_LABELS[value]}</span>}</div>;
}

function FeedbackDrawer({ w, onClose, onDone }: { w: EngWorker; onClose: () => void; onDone: (t: string) => void }) {
  const [rating, setRating] = useState(0);
  const [from, setFrom] = useState('');
  const [comment, setComment] = useState('');
  const [rehire, setRehire] = useState<'' | 'yes' | 'no'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    setBusy(true); setError('');
    try { await api('/api/engagement/feedback', 'POST', { candidateId: w.candidateId, applicationId: w.applicationId, rating, comment, from, wouldRehire: rehire ? rehire === 'yes' : null }); onDone('Feedback logged.'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <Drawer title="Log feedback" kicker={w.name} onClose={onClose} footer={<><button className="btn" onClick={go} disabled={busy || !rating}>Save</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <p style={{ margin: '0 0 4px' }}><b>Rating</b></p><Stars value={rating} onChange={setRating} />
      <label><span>From (e.g. site supervisor)</span><input value={from} maxLength={100} onChange={(e) => setFrom(e.target.value)} /></label>
      <label><span>Would the client have them back?</span><select value={rehire} onChange={(e) => setRehire(e.target.value as '' | 'yes' | 'no')}><option value="">Not asked</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label><span>Notes</span><textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function AskDrawer({ w, onClose, onDone }: { w: EngWorker; onClose: () => void; onDone: (t: string) => void }) {
  const [contact, setContact] = useState(w.contacts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    setBusy(true); setError('');
    try { await api('/api/engagement/feedback-requests', 'POST', { applicationId: w.applicationId, contactId: contact }); onDone('Feedback request sent.'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <Drawer title="Ask the client for feedback" kicker={w.name} onClose={onClose} footer={<><button className="btn" onClick={go} disabled={busy || !contact}>Send request</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <p>The contact gets an email with a one-time link to rate {w.name.split(' ')[0]} (1–5 stars), say whether they’d have them back, and add a comment. The link works for 3 weeks.</p>
      <label><span>Client contact</span><select value={contact} onChange={(e) => setContact(e.target.value)}>{w.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function BirthdayDrawer({ w, onClose, onDone }: { w: EngWorker; onClose: () => void; onDone: (t: string) => void }) {
  const [month, setMonth] = useState(w.birthMonth ?? 0);
  const [day, setDay] = useState(w.birthDay ?? 0);
  const [error, setError] = useState('');
  async function save(clear = false) {
    try { await api('/api/engagement/birthday', 'PATCH', { candidateId: w.candidateId, month: clear ? null : month, day: clear ? null : day }); onDone(clear ? 'Birthday removed.' : 'Birthday saved.'); }
    catch (e) { setError((e as Error).message); }
  }
  return (
    <Drawer title="Birthday" kicker={w.name} onClose={onClose} footer={<><button className="btn" onClick={() => save()} disabled={!month || !day}>Save</button>{w.birthMonth && <button className="btn ghost" onClick={() => save(true)}>Remove</button>}<button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Month and day only, never the year. It’s only used to celebrate, and never shown on candidate profiles or used in matching.</p>
      <div className="row" style={{ marginTop: 0 }}>
        <select aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))}><option value={0}>Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select aria-label="Day" value={day} onChange={(e) => setDay(Number(e.target.value))}><option value={0}>Day</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function GreetingsCard({ on }: { on: boolean }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [v, setV] = useState(on);
  async function save(next: boolean) {
    setV(next);
    try { await api('/api/engagement/settings', 'PATCH', { birthdayGreetings: next }); toast(next ? 'Birthday greetings on.' : 'Birthday greetings off.'); router.refresh(); }
    catch (e) { setV(!next); toast((e as Error).message, true); }
  }
  return (
    <section className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Automatic birthday greetings</h2>
      <label className="check"><input type="checkbox" checked={v} onChange={(e) => save(e.target.checked)} /> Text (or email) workers on assignment “Happy birthday” in the morning on their birthday</label>
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Only people who shared their birthday, once a year, and never to anyone who opted out.</p>
    </section>
  );
}
