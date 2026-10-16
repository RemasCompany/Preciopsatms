'use client';
import { useState } from 'react';
import { EEO_OPTIONS } from '@/lib/eeo';

const EEO = EEO_OPTIONS;
type Facts = { skills: string[]; certs: string[]; yearsExp: number | null; title: string | null; location: string | null };

/** What we read from the applicant's resume, for them to check: remove anything wrong, add what's missing. */
function ResumeCheck({ facts, setFacts }: { facts: Facts; setFacts: (f: Facts) => void }) {
  const [add, setAdd] = useState('');
  const addSkill = () => {
    const v = add.trim().slice(0, 60);
    if (v && !facts.skills.some((s) => s.toLowerCase() === v.toLowerCase())) setFacts({ ...facts, skills: [...facts.skills, v].slice(0, 40) });
    setAdd('');
  };
  const chip = (k: 'skills' | 'certs', v: string) => (
    <span key={k + v} className="chip">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => setFacts({ ...facts, [k]: facts[k].filter((x) => x !== v) })}>×</button></span>
  );
  return (
    <fieldset className="resumecheck">
      <legend>From your resume</legend>
      <p className="muted">Check what we found. Remove anything that isn’t right and add what’s missing — recruiters use this to match you to jobs.</p>
      <span className="lbl">Skills</span>
      <div className="chips">{facts.skills.length ? facts.skills.map((v) => chip('skills', v)) : <span className="muted">None found yet — add your main skills below.</span>}</div>
      <div className="row">
        <input value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} placeholder="Add a skill, e.g. Forklift" aria-label="Add a skill" maxLength={60} />
        <button type="button" className="btn ghost" onClick={addSkill} disabled={!add.trim()}>Add</button>
      </div>
      {facts.certs.length > 0 && <><span className="lbl">Licenses and certifications</span><div className="chips">{facts.certs.map((v) => chip('certs', v))}</div></>}
      <div className="row three">
        <label>Most recent title<input value={facts.title ?? ''} maxLength={120} onChange={(e) => setFacts({ ...facts, title: e.target.value || null })} /></label>
        <label>Years of experience<input type="number" min={0} max={60} value={facts.yearsExp ?? ''} onChange={(e) => setFacts({ ...facts, yearsExp: e.target.value === '' ? null : Math.max(0, Math.min(60, Math.round(+e.target.value))) })} /></label>
        <label>City, state<input value={facts.location ?? ''} maxLength={120} placeholder="Austin, TX" onChange={(e) => setFacts({ ...facts, location: e.target.value || null })} /></label>
      </div>
    </fieldset>
  );
}

export default function ApplyForm({ slug, jobId, company }: { slug: string; jobId: string; company: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');
  const [facts, setFacts] = useState<Facts | null>(null);
  const [reading, setReading] = useState<'' | 'busy' | string>('');
  async function readResume(file: File | null) {
    setFacts(null); setReading('');
    if (!file) return;
    setReading('busy');
    const fd = new FormData(); fd.set('resume', file); fd.set('jobId', jobId);
    try {
      const res = await fetch(`/api/public/${slug}/resume-scan`, { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { setFacts(j.facts); setReading(''); } else setReading(j.error ?? 'We couldn’t read that resume, but you can still apply.');
    } catch { setReading('We couldn’t read that resume, but you can still apply.'); }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setState('sending'); setError('');
    const fd = new FormData(e.currentTarget); fd.set('jobId', jobId);
    if (facts) fd.set('profile', JSON.stringify({ ...facts, title: facts.title?.trim() || null, location: facts.location?.trim() || null }));
    const src = new URLSearchParams(window.location.search).get('src'); if (src) fd.set('src', src);
    const res = await fetch(`/api/public/${slug}/apply`, { method: 'POST', body: fd });
    if (res.ok) setState('done'); else { setError((await res.json().catch(() => ({}))).error ?? 'Something went wrong. Try again.'); setState('idle'); }
  }
  if (state === 'done') return <div className="card"><h2>Application received</h2><p>Thanks for applying to {company}. Check your email for a confirmation.</p></div>;
  return (
    <form className="card apply" onSubmit={submit}>
      <h2>Apply for this job</h2>
      <label>Full name<input name="name" required autoComplete="name" /></label>
      <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Phone<input name="phone" type="tel" autoComplete="tel" /></label>
      <label>Resume (PDF or Word, up to 10 MB)<input name="resume" type="file" accept=".pdf,.doc,.docx,.txt" onChange={(e) => readResume(e.target.files?.[0] ?? null)} /></label>
      {reading === 'busy' && <p className="muted" role="status">Reading your resume…</p>}
      {reading && reading !== 'busy' && <p className="muted" role="status">{reading}</p>}
      {facts && <ResumeCheck facts={facts} setFacts={setFacts} />}
      <label>Anything we should know?<textarea name="message" rows={3} /></label>
      <label className="check"><input type="checkbox" name="smsConsent" /> Text me about this and similar jobs. Message and data rates may apply. Reply STOP to opt out.</label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
      <details>
        <summary>Voluntary self-identification (optional)</summary>
        <p className="muted">{company} is an equal opportunity employer. Answers are voluntary, kept separate from your application, and never used in hiring decisions.</p>
        {Object.entries(EEO).map(([k, opts]) => (
          <label key={k}>{k[0].toUpperCase() + k.slice(1)}<select name={k} defaultValue=""><option value="">Prefer not to answer</option>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>
        ))}
      </details>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={state === 'sending' || reading === 'busy'}>{state === 'sending' ? 'Sending…' : 'Submit application'}</button>
    </form>
  );
}
