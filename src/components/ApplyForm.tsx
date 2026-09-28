'use client';
import { useState } from 'react';

const EEO = {
  gender: ['Female', 'Male', 'Non-binary / another gender', 'Decline to self-identify'],
  race: ['Hispanic or Latino', 'White', 'Black or African American', 'Asian', 'Native Hawaiian or Other Pacific Islander', 'American Indian or Alaska Native', 'Two or more races', 'Decline to self-identify'],
  veteran: ['Protected veteran', 'Not a protected veteran', 'Decline to self-identify'],
  disability: ['Yes, I have a disability', 'No, I do not have a disability', 'Decline to self-identify'],
};

export default function ApplyForm({ slug, jobId, company }: { slug: string; jobId: string; company: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setState('sending'); setError('');
    const fd = new FormData(e.currentTarget); fd.set('jobId', jobId);
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
      <label>Resume (PDF or Word, up to 10 MB)<input name="resume" type="file" accept=".pdf,.doc,.docx,.txt" /></label>
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
      <button className="btn" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Submit application'}</button>
    </form>
  );
}
