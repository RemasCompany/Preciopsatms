'use client';
import { useCallback, useEffect, useState } from 'react';
import { clockLong, dayLabel, overnight, shiftHours } from '@/lib/schedule';
import TimeClock, { type ClockData } from '@/components/TimeClock';
import WorkerOnboarding, { type WorkerOb } from '@/components/WorkerOnboarding';
import WorkerEngagement, { type WorkerEng } from '@/components/WorkerEngagement';
import WorkerReferrals, { type WorkerRef } from '@/components/WorkerReferrals';
import WorkerTraining, { type WorkerCourse } from '@/components/WorkerTraining';
import WorkerSelfService, { type WorkerMe } from '@/components/WorkerSelfService';
import { WorkerDocs, type WorkerDoc } from '@/components/HiringDocs';
import { WorkerInterviews, type WorkerInterview } from '@/components/Interviews';

type Shift = {
  id: string; date: string; start: string; end: string; breakMinutes: number; unit: string | null; notes: string | null;
  job: string; client: string | null; location: string | null; state: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'updating'; past: boolean;
};
type Offer = { id: string; status: 'open' | 'taken'; date: string; start: string; end: string; breakMinutes: number; unit: string | null; notes: string | null; job: string; client: string | null; location: string | null };
type Data = { interviews?: WorkerInterview[]; documents?: WorkerDoc[]; me?: WorkerMe | null; training?: WorkerCourse[]; referrals?: WorkerRef | null; offers?: Offer[]; company: string; brandColor: string; contactEmail: string | null; logoUrl: string | null; firstName: string; shifts: Shift[]; clock: ClockData | null; onboarding?: WorkerOb[]; engagement?: WorkerEng | null };

const STATE: Record<Shift['state'], { text: string; cls: string }> = {
  pending: { text: 'Please confirm', cls: 'a' }, confirmed: { text: 'Confirmed', cls: 'g' }, declined: { text: 'You can’t make it', cls: 'r' },
  cancelled: { text: 'Cancelled', cls: 'r' }, updating: { text: 'Being updated', cls: '' },
};

/** A worker's own schedule, from the private link in their notice: see shifts, confirm or decline each one. */
export default function MyShifts({ params }: { params: { token: string } }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const [offline, setOffline] = useState<string | null>(null); // when the copy on screen was saved, if offline
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/public/shifts/${params.token}`);
      const j = await r.json().catch(() => ({}));
      const cached = r.headers.get('x-from-cache');
      setOffline(cached ? (Number.isNaN(Date.parse(cached)) ? 'earlier' : new Date(cached).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })) : null);
      if (r.ok) setData(j); else setError(j.error ?? 'This link isn’t working.');
    } catch { setError('You’re offline, and this page hasn’t been saved on this phone yet. Open it once with a signal.'); }
  }, [params.token]);
  useEffect(() => { load(); }, [load]);
  // The worker app: installable from this page, and the last copy stays readable without a signal.
  const install = useInstall(params.token);
  useEffect(() => { const back = () => load(); window.addEventListener('online', back); return () => window.removeEventListener('online', back); }, [load]);

  async function respond(s: Shift, response: 'CONFIRMED' | 'DECLINED') {
    setBusy(s.id); setNote('');
    const r = await fetch(`/api/public/shifts/${params.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shiftId: s.id, response, reason: response === 'DECLINED' ? reason : undefined }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setNote(j.error ?? 'That didn’t go through. Try again.'); return; }
    setDeclining(null); setReason('');
    setNote(response === 'CONFIRMED' ? `Thanks — you’re confirmed for ${dayLabel(s.date)}.` : `Got it. We’ll let the team know you can’t make ${dayLabel(s.date)}.`);
    load();
  }

  async function answerOffer(o: Offer, accept: boolean) {
    setBusy(o.id); setNote('');
    const r = await fetch(`/api/public/shifts/${params.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerId: o.id, accept }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    setNote(r.ok ? j.message : j.error ?? 'That didn’t go through. Try again.');
    load();
  }

  if (!data) return <main className="public"><p className={error ? 'error' : 'muted'}>{error || 'Loading…'}</p></main>;
  const upcoming = data.shifts.filter((s) => !s.past);
  const toConfirm = upcoming.filter((s) => s.state === 'pending').length;
  return (
    <main className="public myshifts" style={{ ['--accent' as string]: data.brandColor }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data.logoUrl && /^https:\/\//.test(data.logoUrl) && <img className="careers-logo" src={data.logoUrl} alt={data.company} />}
      <p className="muted" style={{ margin: 0 }}>{data.company}</p>
      {offline && <p className="card banner" role="status">You’re offline. This is your page as of {offline}. Clocking in and other changes need a signal.</p>}
      {install && !offline && <div className="installbar"><span>{install.ios ? 'Add this page to your home screen: tap Share, then “Add to Home Screen”.' : 'Add this page to your phone like an app.'}</span>
        {!install.ios && <button className="btn sm" onClick={install.prompt}>Add to home screen</button>}<button className="btn ghost sm" onClick={install.dismiss} aria-label="Not now">Not now</button></div>}
      <h1>Hi {data.firstName}{data.me || data.clock || data.onboarding?.length || data.training?.length || data.documents?.length || data.interviews?.length ? '' : ', here’s your schedule'}</h1>
      {!!data.interviews?.length && <WorkerInterviews token={params.token} items={data.interviews} onChange={load} />}
      {!!data.documents?.length && <WorkerDocs token={params.token} docs={data.documents} onChange={load} />}
      {data.me && <WorkerSelfService token={params.token} me={data.me} onChange={load} />}
      {!!data.onboarding?.length && <WorkerOnboarding token={params.token} items={data.onboarding} onChange={load} />}
      {!!data.training?.length && <WorkerTraining token={params.token} items={data.training} onChange={load} />}
      {data.clock && <TimeClock token={params.token} data={data.clock} onChange={load} />}
      {data.engagement && <WorkerEngagement token={params.token} data={data.engagement} onChange={load} />}
      {!!data.offers?.length && (
        <section aria-label="Open shifts you can pick up">
          <h2 style={{ marginBottom: 4 }}>Open shifts you can pick up</h2>
          <ul className="shiftlist">{data.offers.map((o) => (
            <li key={o.id} className={`card shiftcard ${o.status === 'taken' ? 'cancelled' : 'pending'}`}>
              <div className="shifthead"><b>{dayLabel(o.date, { weekday: 'long', month: 'long', day: 'numeric' })}</b><span className={`pill ${o.status === 'taken' ? '' : 'a'}`}>{o.status === 'taken' ? 'Taken' : 'Open'}</span></div>
              <p className="shifttime">{clockLong(o.start)} – {clockLong(o.end)}{overnight(o.start, o.end) ? ' (next day)' : ''} <span className="muted">· {+shiftHours(o).toFixed(2)} hours</span></p>
              <p className="muted">{[o.job, o.unit, o.client, o.location].filter(Boolean).join(' · ')}</p>
              {o.notes && <p>{o.notes}</p>}
              {o.status === 'open' ? <div className="row"><button className="btn" disabled={busy === o.id} onClick={() => answerOffer(o, true)}>I’ll take it</button><button className="btn ghost" disabled={busy === o.id} onClick={() => answerOffer(o, false)}>No thanks</button></div>
                : <p className="muted">Someone else picked this one up. Thanks for looking!</p>}
            </li>
          ))}</ul>
        </section>
      )}
      {(data.clock || !!data.onboarding?.length || !!data.offers?.length || !!data.training?.length || !!data.documents?.length || !!data.interviews?.length) && <h2 style={{ marginBottom: 4 }}>Your schedule</h2>}
      <p className="lede">{toConfirm ? `${toConfirm} shift${toConfirm === 1 ? '' : 's'} waiting for you to confirm.` : upcoming.length ? 'You’re all set.' : 'You have no upcoming shifts.'}</p>
      {note && <p className="card banner" role="status">{note}</p>}
      <ul className="shiftlist">
        {upcoming.map((s) => (
          <li key={s.id} className={`card shiftcard ${s.state}`}>
            <div className="shifthead">
              <b>{dayLabel(s.date, { weekday: 'long', month: 'long', day: 'numeric' })}</b>
              <span className={`pill ${STATE[s.state].cls}`}>{STATE[s.state].text}</span>
            </div>
            <p className="shifttime">{clockLong(s.start)} – {clockLong(s.end)}{overnight(s.start, s.end) ? ' (next day)' : ''} <span className="muted">· {+shiftHours(s).toFixed(2)} hours{s.breakMinutes ? `, ${s.breakMinutes} min break` : ''}</span></p>
            <p className="muted">{[s.job, s.unit, s.client, s.location].filter(Boolean).join(' · ')}</p>
            {s.notes && <p>{s.notes}</p>}
            {s.state === 'updating' && <p className="muted">This shift is being changed. You’ll get the new details shortly.</p>}
            {(s.state === 'pending' || s.state === 'confirmed' || s.state === 'declined') && (
              declining === s.id ? (
                <div className="subform">
                  <label>What’s the reason? (optional)<input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. sick, family emergency" /></label>
                  <div className="row"><button className="btn danger" disabled={busy === s.id} onClick={() => respond(s, 'DECLINED')}>I can’t make this shift</button><button className="btn ghost" onClick={() => setDeclining(null)}>Back</button></div>
                </div>
              ) : (
                <div className="row">
                  {s.state !== 'confirmed' && <button className="btn" disabled={busy === s.id} onClick={() => respond(s, 'CONFIRMED')}>Confirm</button>}
                  {s.state !== 'declined' && <button className="btn ghost" disabled={busy === s.id} onClick={() => { setDeclining(s.id); setReason(''); }}>Can’t make it</button>}
                </div>
              )
            )}
          </li>
        ))}
      </ul>
      {data.referrals && <WorkerReferrals token={params.token} data={data.referrals} onChange={load} />}
      {data.contactEmail && <p className="muted">Questions? Email <a href={`mailto:${data.contactEmail}`}>{data.contactEmail}</a>.</p>}
    </main>
  );
}

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
/** Registers the offline helper and offers "Add to home screen" (Android's prompt, or a hint on iPhone) until dismissed. */
function useInstall(token: string) {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    // This worker's own manifest (opens straight to their page), in place of the team app's.
    const l = document.querySelector<HTMLLinkElement>('link[rel="manifest"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'manifest' }));
    l.href = `/api/public/shifts/${token}/manifest`;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/worker-sw.js', { scope: '/shifts/' }).catch(() => undefined);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
    let dismissed = false; try { dismissed = localStorage.getItem('preciops-install-dismissed') === '1'; } catch { /* storage blocked */ }
    if (standalone || dismissed) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIP); setHidden(false); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { setIos(true); setHidden(false); }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [token]);
  if (hidden) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem('preciops-install-dismissed', '1'); } catch { /* storage blocked */ } };
  return { ios, dismiss, prompt: async () => { if (!evt) return; await evt.prompt(); await evt.userChoice.catch(() => undefined); setEvt(null); setHidden(true); } };
}
