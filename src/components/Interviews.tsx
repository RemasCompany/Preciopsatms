'use client';
import { useCallback, useEffect, useState } from 'react';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { INTERVIEW_KINDS, INTERVIEW_STATUS, MAX_SLOTS, RATING, RECOMMENDATIONS, type InterviewStatus } from '@/lib/interviews';

/** Interviews: scheduling (with times for the candidate to pick), the interviews board, scorecards, and the candidate's side. */

type Toast = (m: string, bad?: boolean) => void;
async function api(url: string, method = 'GET', body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'That didn’t work. Try again.');
  return j;
}
type Team = { me: string; options: { id: string; label: string }[] };
let teamP: Promise<Team> | null = null;
const loadTeam = () => (teamP ??= fetch('/api/team/options').then((r) => (r.ok ? r.json() : { me: '', options: [] })).catch(() => ({ me: '', options: [] })));
const sentText = (j: { sent?: string[]; problems?: string[] }) => [j.sent?.length ? `Sent by ${j.sent.map((c) => (c === 'sms' ? 'text' : 'email')).join(' and ')}.` : '', ...(j.problems ?? [])].filter(Boolean).join(' ');

/** Offered times as datetime-local inputs (in the company's time zone). */
function SlotPicker({ slots, setSlots }: { slots: string[]; setSlots: (s: string[]) => void }) {
  return (
    <div className="slots">
      {slots.map((s, i) => (
        <span key={i} className="row" style={{ gap: 6 }}>
          <input type="datetime-local" value={s} step={900} aria-label={`Time ${i + 1}`} onChange={(e) => setSlots(slots.map((x, k) => (k === i ? e.target.value : x)))} />
          {slots.length > 1 && <button type="button" className="btn ghost sm" aria-label={`Remove time ${i + 1}`} onClick={() => setSlots(slots.filter((_, k) => k !== i))}>✕</button>}
        </span>
      ))}
      {slots.length < MAX_SLOTS && <button type="button" className="btn ghost sm" onClick={() => setSlots([...slots, ''])}>+ Another time</button>}
    </div>
  );
}

export function ScheduleInterview({ applications, onDone, onCancel, toast, contact }: {
  applications: { id: string; job: string }[]; onDone: () => void; onCancel: () => void; toast: Toast; contact: { email: boolean; phone: boolean };
}) {
  const [team, setTeam] = useState<Team | null>(null);
  const [f, setF] = useState({ applicationId: applications[0]?.id ?? '', kind: 'VIDEO' as keyof typeof INTERVIEW_KINDS, durationMin: 30, location: '', notes: '' });
  const [who, setWho] = useState<string[]>([]);
  const [slots, setSlots] = useState<string[]>(['', '']);
  const [channels, setChannels] = useState<('email' | 'sms')[]>(contact.email ? ['email'] : contact.phone ? ['sms'] : []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadTeam().then((t) => { setTeam(t); setWho((w) => (w.length ? w : t.me ? [t.me] : [])); }); }, []);
  const filled = slots.filter(Boolean);
  async function submit() {
    setBusy(true);
    try {
      const j = await api('/api/interviews', 'POST', { ...f, interviewerIds: who, slots: filled, channels: filled.length > 1 ? channels : [] });
      toast(j.status === 'SCHEDULED' ? `Scheduled. Calendar invites are on their way. ${sentText({ problems: j.problems })}`.trim() : `Times offered. ${sentText(j)}`.trim(), !!j.problems?.length);
      onDone();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="subform">
      <div className="form">
        {applications.length > 1 && <label className="full"><span>For the job</span><select value={f.applicationId} onChange={(e) => setF({ ...f, applicationId: e.target.value })}>{applications.map((a) => <option key={a.id} value={a.id}>{a.job}</option>)}</select></label>}
        <label><span>Kind</span><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>{Object.entries(INTERVIEW_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span>Length</span><select value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })}>{[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
        <label className="full"><span>{f.kind === 'VIDEO' ? 'Video link' : f.kind === 'PHONE' ? 'Number to call (blank: their number on file)' : 'Address'}</span><input value={f.location} maxLength={300} placeholder={f.kind === 'VIDEO' ? 'https://…' : f.kind === 'ONSITE' ? 'Street, city' : ''} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
        <fieldset className="full docpick"><legend>Interviewers</legend>
          {team?.options.map((o) => <label key={o.id} className="check"><input type="checkbox" checked={who.includes(o.id)} onChange={(e) => setWho(e.target.checked ? [...who, o.id] : who.filter((x) => x !== o.id))} /> {o.label}{o.id === team.me ? ' (you)' : ''}</label>)}
        </fieldset>
        <div className="full"><span className="muted" style={{ fontSize: 13 }}>Times to offer (your company’s time zone). One time books it straight away; several let the candidate pick.</span><SlotPicker slots={slots} setSlots={setSlots} /></div>
        <label className="full"><span>Note for the candidate (optional)</span><textarea rows={2} maxLength={1000} value={f.notes} placeholder="e.g. Ask for Dee at the front desk; wear closed-toe shoes" onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {filled.length > 1 && <div className="full row" style={{ flexWrap: 'wrap' }}><span className="muted">Send them the times by</span>
          <label className="check"><input type="checkbox" disabled={!contact.email} checked={channels.includes('email')} onChange={(e) => setChannels(e.target.checked ? [...channels, 'email'] : channels.filter((c) => c !== 'email'))} /> Email</label>
          <label className="check"><input type="checkbox" disabled={!contact.phone} checked={channels.includes('sms')} onChange={(e) => setChannels(e.target.checked ? [...channels, 'sms'] : channels.filter((c) => c !== 'sms'))} /> Text</label></div>}
      </div>
      <div className="row"><button className="btn sm" disabled={busy || !filled.length || !who.length || !f.applicationId} onClick={submit}>{filled.length > 1 ? `Offer ${filled.length} times` : 'Schedule'}</button><button className="btn ghost sm" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

type Row = { id: string; title: string; kind: string; status: InterviewStatus; candidate: string; candidateId: string; job: string; startsLabel: string | null; slotCount: number; candidateNote: string | null; interviewers: string[]; scorecards: string; verdict: string | null };
const statusPill = (s: InterviewStatus) => <span className={`pill ${INTERVIEW_STATUS[s].pill}`}>{s === 'PROPOSED' ? 'Picking a time' : INTERVIEW_STATUS[s].text}</span>;

/** A candidate's interviews, on their record. */
export function CandidateInterviews({ candidateId, applications, canEdit, toast, contact }: { candidateId: string; applications: { id: string; job: string; stage: string }[]; canEdit: boolean; toast: Toast; contact: { email: boolean; phone: boolean } }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { try { setRows(await api(`/api/interviews?candidate=${candidateId}`)); } catch { setRows([]); } }, [candidateId]);
  useEffect(() => { load(); }, [load]);
  const live = applications.filter((a) => a.stage !== 'REJECTED');
  return (
    <section className="sec"><h3>Interviews {rows && <span className="muted">{rows.length}</span>}</h3>
      {rows?.length ? <div className="list">{rows.map((r) => (
        <button key={r.id} className="li link" onClick={() => setOpen(r.id)}><span className="x"><b>{r.title}</b><span className="muted">{r.startsLabel ?? (r.status === 'PROPOSED' ? `${r.slotCount} times offered${r.candidateNote ? ' · asked for other times' : ''}` : '')} · {r.interviewers.join(', ')}{r.verdict ? ` · ${r.verdict}` : ''}</span></span>{statusPill(r.status)}</button>
      ))}</div> : rows && !adding && <p className="muted">No interviews yet.</p>}
      {canEdit && live.length > 0 && (adding ? <ScheduleInterview applications={live} toast={toast} contact={contact} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />
        : <div className="row"><button className="btn ghost sm" onClick={() => setAdding(true)}>Schedule interview</button></div>)}
      {open && <InterviewDrawer id={open} canEdit={canEdit} toast={toast} onClose={() => { setOpen(null); load(); }} />}
    </section>
  );
}

type Detail = {
  id: string; title: string; kind: string; durationMin: number; location: string | null; notes: string | null; status: InterviewStatus; candidateNote: string | null; cancelReason: string | null;
  startsAt: string | null; startsLabel: string | null; slots: { at: string; label: string }[]; candidate: { id: string; name: string; title: string | null }; job: string;
  interviewers: { id: string; name: string; submitted: boolean }[]; competencies: string[]; iAmInterviewer: boolean; canScore: boolean;
  mine: { ratings: Record<string, number>; recommendation: string; notes: string | null } | null; hidden: number;
  scorecards: { by: string; mine: boolean; ratings: Record<string, number>; recommendation: string; notes: string | null; at: string }[];
  summary: null | { count: number; competencies: { name: string; average: number }[]; recommendations: Record<string, number>; verdict: string | null };
};

export function InterviewDrawer({ id, canEdit, toast, onClose }: { id: string; canEdit: boolean; toast: Toast; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [mode, setMode] = useState<'view' | 'cancel' | 'move'>('view');
  const [reason, setReason] = useState('');
  const [slots, setSlots] = useState<string[]>(['']);
  const [card, setCard] = useState<{ ratings: Record<string, number>; recommendation: string; notes: string }>({ ratings: {}, recommendation: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const x: Detail = await api(`/api/interviews/${id}`); setD(x); if (x.mine) setCard({ ratings: x.mine.ratings, recommendation: x.mine.recommendation, notes: x.mine.notes ?? '' }); }
    catch (e) { toast((e as Error).message, true); onClose(); }
  }, [id, toast, onClose]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: () => Promise<string>) => { setBusy(true); try { toast(await fn()); setMode('view'); await load(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } };
  if (!d) return <Drawer title="Loading…" onClose={onClose}><p className="muted">Loading…</p></Drawer>;
  const past = !!d.startsAt && new Date(d.startsAt) <= new Date();
  const open = d.status === 'PROPOSED' || d.status === 'SCHEDULED';
  return (
    <Drawer title={d.title} kicker={`${d.candidate.name} · ${d.job}`} onClose={onClose} wide footer={canEdit && open && mode === 'view' ? <>
      {past && d.status === 'SCHEDULED' && <><button className="btn ghost" disabled={busy} onClick={() => run(async () => { await api(`/api/interviews/${id}`, 'PATCH', { action: 'outcome', status: 'COMPLETED' }); return 'Marked done.'; })}>Mark done</button>
        <button className="btn ghost" disabled={busy} onClick={() => run(async () => { await api(`/api/interviews/${id}`, 'PATCH', { action: 'outcome', status: 'NO_SHOW' }); return 'Marked as a no-show.'; })}>No-show</button></>}
      {!past && <button className="btn ghost" onClick={() => setMode('move')}>Reschedule</button>}
      <span style={{ flex: 1 }} />
      <button className="btn danger" onClick={() => setMode('cancel')}>Cancel interview</button>
    </> : undefined}>
      <p>{statusPill(d.status)} <span className="muted">{d.startsLabel ? `${d.startsLabel} · ` : ''}{d.durationMin} minutes · {INTERVIEW_KINDS[d.kind as keyof typeof INTERVIEW_KINDS]}</span></p>
      {d.status === 'PROPOSED' && <p className="muted">Offered: {d.slots.map((s) => s.label).join(' · ')}</p>}
      {d.candidateNote && <p className="warn">{d.candidate.name.split(' ')[0]} asked for other times: {d.candidateNote}</p>}
      {d.cancelReason && <p className="muted">Cancelled: {d.cancelReason}</p>}
      <dl className="facts">
        {d.location && <><dt>{d.kind === 'VIDEO' ? 'Video link' : d.kind === 'PHONE' ? 'Phone' : 'Address'}</dt><dd>{d.location}</dd></>}
        <dt>Interviewers</dt><dd>{d.interviewers.map((i) => `${i.name}${i.submitted ? ' ✓' : ''}`).join(', ')}</dd>
        {d.notes && <><dt>Note to the candidate</dt><dd>{d.notes}</dd></>}
      </dl>
      {mode === 'cancel' && <div className="subform"><label><span>Reason (they’ll see it)</span><input value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="e.g. The client paused the role" /></label>
        <div className="row"><button className="btn danger sm" disabled={busy} onClick={() => run(async () => { const j = await api(`/api/interviews/${id}`, 'PATCH', { action: 'cancel', reason }); return `Cancelled. ${sentText(j)}`.trim(); })}>Cancel the interview</button><button className="btn ghost sm" onClick={() => setMode('view')}>Back</button></div></div>}
      {mode === 'move' && <div className="subform"><span className="muted" style={{ fontSize: 13 }}>New times (one books it; several let them pick again). A booked time is cancelled on everyone’s calendar first.</span><SlotPicker slots={slots} setSlots={setSlots} />
        <div className="row"><button className="btn sm" disabled={busy || !slots.filter(Boolean).length} onClick={() => run(async () => { const j = await api(`/api/interviews/${id}`, 'PATCH', { action: 'reschedule', slots: slots.filter(Boolean), channels: ['email'] }); return `Rescheduled. ${sentText(j)}`.trim(); })}>Save new times</button><button className="btn ghost sm" onClick={() => setMode('view')}>Back</button></div></div>}

      {(past || d.scorecards.length > 0) && d.status !== 'CANCELLED' && (
        <section className="sec"><h3>Scorecards <span className="muted">{d.interviewers.filter((i) => i.submitted).length} of {d.interviewers.length}</span></h3>
          {d.summary && d.summary.count > 0 && <div className="scoresum">
            <p style={{ margin: '0 0 6px' }}><b>{d.summary.verdict}</b> <span className="muted">· {Object.entries(d.summary.recommendations).filter(([, n]) => n).map(([k, n]) => `${n} ${RECOMMENDATIONS[k as keyof typeof RECOMMENDATIONS].toLowerCase()}`).join(', ')}</span></p>
            {d.summary.competencies.map((c) => <div key={c.name} className="scorerow"><span>{c.name}</span><span className="meter" aria-hidden="true"><i style={{ width: `${(c.average / 4) * 100}%` }} /></span><span className="num">{c.average.toFixed(1)}</span></div>)}
          </div>}
          {d.hidden > 0 && <p className="muted">{d.hidden} other scorecard{d.hidden === 1 ? ' is' : 's are'} hidden until you submit yours, so you aren’t influenced by them.</p>}
          {d.scorecards.filter((s) => !s.mine).map((s, i) => <div key={i} className="card" style={{ margin: '8px 0', padding: 12 }}><b>{s.by}</b> · {RECOMMENDATIONS[s.recommendation as keyof typeof RECOMMENDATIONS]}
            <div className="muted" style={{ fontSize: 13 }}>{Object.entries(s.ratings).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>{s.notes && <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{s.notes}</p>}</div>)}
          {d.canScore && past && ['SCHEDULED', 'COMPLETED'].includes(d.status) && (
            <div className="subform">
              <b>{d.mine ? 'Your scorecard' : 'Fill in your scorecard'}</b>
              {d.competencies.map((c) => (
                <fieldset key={c} className="ratefield"><legend>{c}</legend>
                  {[1, 2, 3, 4].map((n) => <label key={n} className={`rate${card.ratings[c] === n ? ' on' : ''}`} title={RATING[n as 1]}><input type="radio" name={`r-${c}`} checked={card.ratings[c] === n} onChange={() => setCard({ ...card, ratings: { ...card.ratings, [c]: n } })} aria-label={`${c}: ${n}, ${RATING[n as 1]}`} /><span>{n}</span></label>)}
                  <span className="muted" style={{ fontSize: 12 }}>{card.ratings[c] ? RATING[card.ratings[c] as 1] : ''}</span>
                </fieldset>
              ))}
              <fieldset className="ratefield"><legend>Overall recommendation</legend>
                {Object.entries(RECOMMENDATIONS).map(([k, l]) => <label key={k} className="check" style={{ margin: 0 }}><input type="radio" name="rec" checked={card.recommendation === k} onChange={() => setCard({ ...card, recommendation: k })} /> {l}</label>)}
              </fieldset>
              <label><span>Notes (what they said or did that led to your ratings)</span><textarea rows={3} maxLength={4000} value={card.notes} onChange={(e) => setCard({ ...card, notes: e.target.value })} /></label>
              <div className="row"><button className="btn sm" disabled={busy || !card.recommendation} onClick={() => run(async () => { await api(`/api/interviews/${id}/scorecard`, 'POST', { ...card, notes: card.notes || null }); return d.mine ? 'Scorecard updated.' : 'Scorecard submitted.'; })}>{d.mine ? 'Update scorecard' : 'Submit scorecard'}</button></div>
            </div>
          )}
        </section>
      )}
    </Drawer>
  );
}

/** The Interviews page. */
export default function InterviewsBoard({ openId }: { openId?: string }) {
  const { canEdit, toast } = useRecords();
  const [view, setView] = useState<'upcoming' | 'feedback' | 'waiting' | 'past'>('upcoming');
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const load = useCallback(async () => {
    setRows(null);
    const [list, fb, wt] = await Promise.all([api(`/api/interviews?view=${view}${mine ? '&mine=1' : ''}`), api('/api/interviews?view=feedback'), api(`/api/interviews?view=waiting${mine ? '&mine=1' : ''}`)]).catch(() => [[], [], []]);
    setRows(list); setCounts({ feedback: fb.length, waiting: wt.length });
  }, [view, mine]);
  useEffect(() => { load(); }, [load]);
  const TABS = [['upcoming', 'Upcoming'], ['feedback', `Your scorecards${counts.feedback ? ` (${counts.feedback})` : ''}`], ['waiting', `Picking a time${counts.waiting ? ` (${counts.waiting})` : ''}`], ['past', 'Past']] as const;
  return (
    <>
      <div className="bar" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={`btn ${view === k ? '' : 'ghost'} sm`} onClick={() => setView(k)}>{l}</button>)}
        <span style={{ flex: 1 }} />
        {view !== 'feedback' && <label className="check muted" style={{ margin: 0 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>}
      </div>
      <div className="card" style={{ marginTop: 0 }}>
        {rows === null ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">{view === 'upcoming' ? 'No interviews coming up. Schedule one from a candidate’s record.' : view === 'feedback' ? 'You’re all caught up on scorecards.' : view === 'waiting' ? 'No one is choosing a time right now.' : 'No interviews in the last two months.'}</p> : (
          <div className="list">{rows.map((r) => (
            <button key={r.id} className="li link" onClick={() => setOpen(r.id)}>
              <span className="x"><b>{r.candidate}</b><span className="muted">{r.title} · {r.startsLabel ?? `${r.slotCount} times offered`}{r.candidateNote ? ' · asked for other times' : ''}</span><span className="muted">{r.interviewers.join(', ')} · scorecards {r.scorecards}{r.verdict ? ` · ${r.verdict}` : ''}</span></span>
              {statusPill(r.status)}
            </button>
          ))}</div>
        )}
      </div>
      {open && <InterviewDrawer id={open} canEdit={canEdit} toast={toast} onClose={() => { setOpen(null); load(); }} />}
    </>
  );
}

// ---- the candidate's side ----
export type WorkerInterview = { id: string; title: string; kind: string; durationMin: number; status: 'PROPOSED' | 'SCHEDULED'; notes: string | null; askedForOthers: boolean; location: string | null; startsAt: string | null; startsLabel: string | null; slots: { at: string; label: string }[] };

export function WorkerInterviews({ token, items, onChange }: { token: string; items: WorkerInterview[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [noneFor, setNoneFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  async function send(body: object) {
    setBusy(true); setMsg(null);
    try { const r = await fetch(`/api/public/interviews/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); setMsg(r.ok ? { text: j.message } : { text: j.error ?? 'That didn’t go through. Try again.', bad: true }); if (r.ok) { setNoneFor(null); onChange(); } }
    catch { setMsg({ text: 'Couldn’t connect. Check your signal and try again.', bad: true }); } finally { setBusy(false); }
  }
  return (
    <section className="card" id="interviews" aria-label="Your interviews">
      <h2 style={{ marginTop: 0 }}>{items.some((i) => i.status === 'PROPOSED' && i.slots.length) ? 'Pick a time for your interview' : 'Your interview'}</h2>
      {items.map((iv) => (
        <div key={iv.id} className="ivitem">
          <b>{iv.title}</b> <span className="muted">· {iv.durationMin} minutes · {INTERVIEW_KINDS[iv.kind as keyof typeof INTERVIEW_KINDS]}</span>
          {iv.status === 'SCHEDULED' ? <>
            <p style={{ margin: '6px 0', fontSize: 18 }}><b>{iv.startsLabel}</b></p>
            {iv.location && <p style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>{iv.kind === 'VIDEO' ? <>Join: <a href={iv.location} target="_blank" rel="noopener noreferrer">{iv.location}</a></> : iv.kind === 'PHONE' ? `We’ll call ${iv.location}` : `Where: ${iv.location}`}</p>}
            {iv.notes && <p className="muted" style={{ margin: '4px 0' }}>{iv.notes}</p>}
            <a className="btn ghost sm" href={`/api/public/interviews/${token}/ics?id=${iv.id}`}>Add to my calendar</a>
          </> : iv.askedForOthers && !iv.slots.length ? <p className="muted">Thanks — we’ll send you other times soon.</p> : <>
            {iv.notes && <p className="muted" style={{ margin: '4px 0' }}>{iv.notes}</p>}
            <div className="slotlist" role="radiogroup" aria-label="Times">{iv.slots.map((s) => <label key={s.at} className={`slotopt${pick[iv.id] === s.at ? ' on' : ''}`}><input type="radio" name={`slot-${iv.id}`} checked={pick[iv.id] === s.at} onChange={() => setPick({ ...pick, [iv.id]: s.at })} /> {s.label}</label>)}</div>
            <div className="row"><button className="btn" disabled={busy || !pick[iv.id]} onClick={() => send({ action: 'pick', interviewId: iv.id, at: pick[iv.id] })}>Book this time</button>
              {noneFor !== iv.id && <button className="btn ghost" onClick={() => { setNoneFor(iv.id); setNote(''); }}>None of these work</button>}</div>
            {noneFor === iv.id && <div className="subform"><label><span>When are you free? (optional)</span><input value={note} maxLength={300} placeholder="e.g. Weekday mornings" onChange={(e) => setNote(e.target.value)} /></label>
              <div className="row"><button className="btn sm" disabled={busy} onClick={() => send({ action: 'none', interviewId: iv.id, note: note || undefined })}>Ask for other times</button><button className="btn ghost sm" onClick={() => setNoneFor(null)}>Back</button></div></div>}
          </>}
        </div>
      ))}
      {msg && <p className={msg.bad ? 'error' : 'okc'} role="status">{msg.text}</p>}
    </section>
  );
}
