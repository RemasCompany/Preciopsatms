'use client';
import { useState } from 'react';
import type { RecordValues } from '@/lib/records';
import { ASSISTANT_NAME } from '@/lib/assistant-name';
import type { JobDraft } from '@/app/api/ai/job-post/route';

const empty = (v: unknown) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/**
 * In the job drawer: describe the job in plain words and the assistant writes the post (title, description, skills,
 * sector, type). Fields someone already filled in are kept; the description is replaced only after asking.
 */
export default function JobAiPanel({ isNew, values, setValues }: { isNew: boolean; values: RecordValues; setValues: (v: RecordValues) => void }) {
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const hasDescription = !empty(values.description);

  async function write() {
    if (hasDescription && !confirm(`${ASSISTANT_NAME} will rewrite the current description. Continue?`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/ai/job-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, title: values.title, location: values.location, type: values.type, sector: values.sector, payRate: values.payRate, skills: values.skills, description: values.description }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Something went wrong. Try again.');
      const d = j.draft as JobDraft;
      const next: RecordValues = { ...values, description: d.description };
      const filled = ['description'];
      if (empty(values.title) && d.title) { next.title = d.title; filled.push('title'); }
      if (empty(values.sector) && d.sector) { next.sector = d.sector; filled.push('sector'); }
      if (isNew && d.type && d.type !== values.type) { next.type = d.type; filled.push('employment type'); }
      if (isNew && d.openings && (values.openings == null || values.openings === 1) && d.openings !== 1) { next.openings = d.openings; filled.push('openings'); }
      if (empty(values.payRate) && d.payRate) { next.payRate = d.payRate; filled.push('pay rate'); }
      const skills = (values.skills as string[] | null) ?? [];
      const added = d.skills.filter((s) => !skills.some((x) => x.toLowerCase() === s.toLowerCase()));
      if (added.length) { next.skills = [...skills, ...added]; filled.push(`${added.length} skill${added.length === 1 ? '' : 's'}`); }
      setValues(next);
      setMsg({ text: `Filled in: ${filled.join(', ')}. Review everything below, then ${isNew ? 'add the job' : 'save'}.` });
    } catch (e) { setMsg({ text: (e as Error).message, error: true }); } finally { setBusy(false); }
  }

  return (
    <section className="resume">
      <b>{isNew ? `Create this job with ${ASSISTANT_NAME}` : `Improve this post with ${ASSISTANT_NAME}`}</b>
      <p className="muted" style={{ margin: '4px 0 8px' }}>
        {isNew ? 'Describe the job in your own words, or paste the client’s notes. The title, description, skills and details fill in below for you to review.'
          : 'Add anything to change or include, or leave it blank to polish the current description.'} Pay is only filled in if you mention it. Emails and phone numbers aren’t sent to the AI.
      </p>
      <textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} aria-label="Describe the job"
        placeholder="e.g. 3 night-shift CNAs for a nursing home in Boca Raton, FL. $22/hr, 12-hour shifts, need active Florida CNA license and BLS. Start ASAP." />
      <div className="row">
        <button type="button" className="btn sm" disabled={busy || (isNew && brief.trim().length < 10 && empty(values.title))} onClick={write}>
          {busy ? 'Writing…' : isNew ? 'Write job post' : 'Rewrite description'}
        </button>
      </div>
      {msg && <p className={msg.error ? 'warn' : 'muted'} role="status">{msg.text}</p>}
    </section>
  );
}
