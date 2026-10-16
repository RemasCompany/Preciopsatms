'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { fmtDate } from '@/lib/people-shared';

export type Schedule = { on: boolean; frequency: 'ANNUAL' | 'SEMIANNUAL' | 'NONE'; basis: 'HIRE_DATE' | 'CALENDAR'; month: number; leadDays: number };
export type Upcoming = { employeeId: string; name: string; title: string; manager: string | null; frequency: 'ANNUAL' | 'SEMIANNUAL'; due: string; daysLeft: number; reviewId: string | null; inCycle: string | null };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FREQ = { ANNUAL: 'Annual', SEMIANNUAL: 'Semi-annual', NONE: 'No scheduled reviews' } as const;
const when = (d: number) => (d > 1 ? `in ${d} days` : d === 1 ? 'tomorrow' : d === 0 ? 'today' : `${-d} day${d === -1 ? '' : 's'} overdue`);

export function describe(s: Schedule) {
  if (!s.on) return 'Off — reviews only happen when you start a cycle.';
  const f = s.frequency === 'NONE' ? 'No one is reviewed by default' : `${FREQ[s.frequency]} by default`;
  const b = s.basis === 'HIRE_DATE' ? 'on each work anniversary' : s.frequency === 'SEMIANNUAL' ? `at the end of ${MONTHS[s.month - 1]} and ${MONTHS[(s.month + 5) % 12]}` : `at the end of ${MONTHS[s.month - 1]}`;
  return `${f}, ${b}. Reviews are added ${s.leadDays} days ahead; managers are reminded 30, 14, 7 and 1 days before, on the day, then weekly while overdue — for review cycles you start by hand too.`;
}

/** The review schedule and who's coming due, at the top of the Reviews page. */
export default function ReviewSchedule({ schedule, upcoming, admin, onOpen }: { schedule: Schedule; upcoming: Upcoming[]; admin: boolean; onOpen?: (reviewId: string) => void }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(schedule);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    const res = await fetch('/api/reviews/schedule', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewScheduleOn: v.on, reviewFrequency: v.frequency, reviewBasis: v.basis, reviewMonth: v.month, reviewLeadDays: v.leadDays }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? 'Could not save the schedule.');
    toast(v.on ? `Review schedule saved.${j.added ? ` Added ${j.added} review${j.added === 1 ? '' : 's'} coming due.` : ''}` : 'Review schedule turned off.');
    setEdit(false); router.refresh();
  }
  const overdue = upcoming.filter((u) => u.daysLeft < 0).length;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', margin: 0 }}>
        <div><h2 style={{ margin: 0, fontSize: 18 }}>Review schedule {schedule.on ? <span className="pill g">On</span> : <span className="pill">Off</span>}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>{describe(schedule)}</p></div>
        {admin && <button className="btn ghost" onClick={() => { setV(schedule); setEdit(true); }}>{schedule.on ? 'Change' : 'Set up'}</button>}
      </div>
      {schedule.on && (upcoming.length ? <>
        <h3 style={{ margin: '14px 0 6px', fontSize: 15 }}>Coming due in the next 60 days{overdue ? <span className="pill r" style={{ marginLeft: 8 }}>{overdue} overdue</span> : null}</h3>
        <div className="list">{upcoming.map((u) => (
          <div key={u.employeeId} className="li">
            <div className="x"><b>{u.name}</b><span className="muted">{u.title} · {FREQ[u.frequency].toLowerCase()} review · manager {u.manager ?? <i>not set — HR is reminded</i>}</span></div>
            <span className="row" style={{ gap: 8, margin: 0 }}>
              <span className={`pill ${u.daysLeft < 0 ? 'r' : u.daysLeft <= 7 ? 'a' : ''}`}>{fmtDate(u.due)} · {when(u.daysLeft)}</span>
              {u.reviewId && onOpen ? <button className="btn ghost sm" onClick={() => onOpen(u.reviewId!)}>Open</button> : <span className="muted" style={{ fontSize: 12.5 }}>{u.inCycle ? `In ${u.inCycle}` : u.reviewId ? 'Added' : `Added ${schedule.leadDays} days before`}</span>}
            </span>
          </div>
        ))}</div>
      </> : <p className="muted" style={{ marginBottom: 0 }}>No reviews coming due in the next 60 days.</p>)}

      {edit && (
        <Drawer title="Review schedule" kicker="Performance reviews" onClose={() => setEdit(false)}
          footer={<><button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button className="btn ghost" onClick={() => setEdit(false)}>Cancel</button></>}>
          <label className="check"><input type="checkbox" checked={v.on} onChange={(e) => setV({ ...v, on: e.target.checked })} /> Add reviews automatically and remind managers when they’re due</label>
          <label><span>How often, by default</span><select value={v.frequency} onChange={(e) => setV({ ...v, frequency: e.target.value as Schedule['frequency'] })}>
            <option value="ANNUAL">Annual — once a year</option><option value="SEMIANNUAL">Semi-annual — every six months</option><option value="NONE">No scheduled reviews</option></select></label>
          <p className="muted" style={{ marginTop: -4 }}>Change it for one person on their employee record (for example, semi-annual for new hires or hourly staff).</p>
          <label><span>When reviews fall due</span><select value={v.basis} onChange={(e) => setV({ ...v, basis: e.target.value as Schedule['basis'] })}>
            <option value="HIRE_DATE">On each person’s work anniversary</option><option value="CALENDAR">In fixed months, for everyone</option></select></label>
          {v.basis === 'CALENDAR' && <label><span>Review month</span><select value={v.month} onChange={(e) => setV({ ...v, month: Number(e.target.value) })}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}{v.frequency === 'SEMIANNUAL' ? ` and ${MONTHS[(i + 6) % 12]}` : ''}</option>)}</select></label>}
          {v.basis === 'CALENDAR' && <p className="muted" style={{ marginTop: -4 }}>Reviews are due on the last day of the month. People who started less than 90 days before skip to the next one.</p>}
          <label><span>Add each review and send the first reminder this many days ahead</span><input type="number" min={7} max={90} value={v.leadDays} onChange={(e) => setV({ ...v, leadDays: Number(e.target.value) })} /></label>
          <p className="muted">Each manager gets one email listing their team’s reviews, plus a task in Preciops if they have an account. Reviews for people with no manager — or whose manager has no account or email — go to owners and admins. Reminders stop once the manager review is submitted.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
    </section>
  );
}
