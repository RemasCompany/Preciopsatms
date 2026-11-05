'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { INTERVIEW_KINDS } from '@/lib/interviews';
import type { Automation } from '@/lib/automation';

/** Hiring automations: screen strong applicants, offer interview times, start onboarding at the offer. Admins edit. */
export default function Automations({ initial, team, packages, readOnly, onboarding }: {
  initial: Automation; team: { id: string; name: string }[]; packages: { id: string; name: string }[]; readOnly: boolean; onboarding: boolean;
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [a, setA] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(a) !== JSON.stringify(initial);
  const set = <K extends keyof Automation>(k: K, v: Partial<Automation[K]>) => setA((x) => ({ ...x, [k]: Array.isArray(v) ? v : { ...(x[k] as object), ...v } }));
  const ch = (c: 'email' | 'sms', on: boolean) => setA((x) => ({ ...x, channels: on ? [...new Set([...x.channels, c])] : x.channels.filter((y) => y !== c) }));

  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/settings/automation', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Couldn’t save. Try again.');
      toast('Automations saved.'); router.refresh();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <section className="card" id="automations">
      <h2 style={{ marginTop: 0 }}>Hiring automations</h2>
      <p className="muted" style={{ marginTop: 0 }}>Let routine steps run on their own so your team spends its time on people. Every automatic step is logged in Activity. Nobody is ever rejected automatically.</p>
      <fieldset disabled={readOnly || busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="check"><input type="checkbox" checked={a.screen.on} onChange={(e) => set('screen', { on: e.target.checked })} /> <span><b>Screen new applicants</b> — move anyone whose match score is at least
          <input type="number" min={40} max={100} style={{ width: 70, margin: '0 6px' }} value={a.screen.advanceAt} onChange={(e) => set('screen', { advanceAt: Number(e.target.value) })} aria-label="Match score to move to Screened" />
          to Screened. The score weighs skills, certifications, experience, location and pay.</span></label>

        <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={a.interviews.on} onChange={(e) => set('interviews', { on: e.target.checked })} /> <span><b>Offer interview times</b> — when someone reaches Screened, send them times to pick from the interviewer’s free hours. Their pick books it and sends calendar invites.</span></label>
        {a.interviews.on && (
          <div className="form wide subform">
            <label><span>Interviewer</span><select value={a.interviews.interviewerId ?? ''} onChange={(e) => set('interviews', { interviewerId: e.target.value || null })}><option value="">Choose…</option>{team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label><span>Kind</span><select value={a.interviews.kind} onChange={(e) => set('interviews', { kind: e.target.value as Automation['interviews']['kind'] })}>{Object.entries(INTERVIEW_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label><span>Length (minutes)</span><input type="number" min={15} max={120} step={15} value={a.interviews.durationMin} onChange={(e) => set('interviews', { durationMin: Number(e.target.value) })} /></label>
            <label><span>Times to offer</span><input type="number" min={2} max={6} value={a.interviews.count} onChange={(e) => set('interviews', { count: Number(e.target.value) })} /></label>
            <label><span>Interview hours start</span><input type="time" value={a.interviews.from} onChange={(e) => set('interviews', { from: e.target.value })} /></label>
            <label><span>End</span><input type="time" value={a.interviews.to} onChange={(e) => set('interviews', { to: e.target.value })} /></label>
            {a.interviews.kind === 'ONSITE' && <label style={{ gridColumn: '1/-1' }}><span>Address</span><input value={a.interviews.location ?? ''} maxLength={300} onChange={(e) => set('interviews', { location: e.target.value || null })} /></label>}
          </div>
        )}

        {onboarding && <>
          <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={a.onboarding.on} onChange={(e) => set('onboarding', { on: e.target.checked })} /> <span><b>Start onboarding at the offer</b> — when someone moves to Offer (or straight to Placed), start their new-hire paperwork and send them the link.</span></label>
          {a.onboarding.on && <div className="form wide subform"><label><span>Package</span><select value={a.onboarding.packageId ?? ''} onChange={(e) => set('onboarding', { packageId: e.target.value || null })}><option value="">Choose…</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>}
        </>}

        <div className="row" style={{ marginTop: 10 }}><span className="muted">Candidates hear from you by</span>
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={a.channels.includes('email')} onChange={(e) => ch('email', e.target.checked)} /> Email</label>
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={a.channels.includes('sms')} onChange={(e) => ch('sms', e.target.checked)} /> Text</label>
          <span className="muted" style={{ fontSize: 13 }}>(opt-outs are always honored)</span></div>
      </fieldset>
      {!readOnly && <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save automations'}</button></div>}
      <p className="muted" style={{ marginBottom: 0 }}>Already automatic: open jobs post to your careers page and job-board feeds and come down when filled; resumes fill in the applicant’s profile; hiring someone creates their employee record from their application.</p>
    </section>
  );
}
