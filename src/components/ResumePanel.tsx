'use client';
import { useRef, useState } from 'react';
import type { RecordValues } from '@/lib/records';
import type { ParsedProfile } from '@/lib/resume';

const KEYS = ['name', 'email', 'phone', 'title', 'location', 'sector', 'yearsExp', 'skills', 'certs', 'summary'] as const;
const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** Applies a parsed profile to the form. New candidates take every value found; existing ones only fill blanks. */
export function applyProfile(values: RecordValues, p: ParsedProfile, onlyEmpty: boolean) {
  const next = { ...values }; let n = 0;
  for (const k of KEYS) {
    const v = p[k];
    if (empty(v) || (onlyEmpty && !empty(values[k]))) continue;
    next[k] = v as RecordValues[string]; n++;
  }
  return { next, filled: n };
}

async function parse(body: FormData | object) {
  const res = await fetch('/api/ai/parse-resume', body instanceof FormData ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? 'The resume couldn’t be read. Try again.');
  return j.profile as ParsedProfile;
}

export default function ResumePanel({ candidateId, resume, ai, values, setValues, onPendingFile, reload, toast }: {
  candidateId?: string; resume?: { filename: string } | null; ai: boolean; values: RecordValues; setValues: (v: RecordValues) => void;
  onPendingFile?: (f: File | null) => void; reload?: () => void; toast: (t: string, err?: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function run(label: string, body: FormData | object, onlyEmpty: boolean) {
    setBusy(label); setMsg(null);
    try {
      const { next, filled } = applyProfile(values, await parse(body), onlyEmpty);
      setValues(next);
      setMsg({ text: filled ? `Filled ${filled} field${filled === 1 ? '' : 's'}. Review them, then ${candidateId ? 'save' : 'add the candidate'}.` : 'Nothing new found to fill in.' });
    } catch (e) { setMsg({ text: (e as Error).message, error: true }); } finally { setBusy(''); }
  }
  function pick(f: File | null) {
    setFile(f); onPendingFile?.(f); setMsg(null);
    if (f && ai && !candidateId) { const fd = new FormData(); fd.set('file', f); run('file', fd, false); }
  }
  async function upload(f: File) {
    setBusy('upload');
    const fd = new FormData(); fd.set('file', f);
    const res = await fetch(`/api/candidates/${candidateId}/resume`, { method: 'POST', body: fd });
    setBusy('');
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? 'Upload failed.', true);
    toast('Resume attached.'); reload?.();
  }

  if (candidateId) return (
    <section className="resume">
      <div className="row" style={{ marginTop: 0 }}>
        <b style={{ flex: 1 }}>Resume{resume ? `: ${resume.filename}` : ''}</b>
        {resume && <a className="btn ghost sm" href={`/api/candidates/${candidateId}/resume`}>Download</a>}
        {resume && ai && <button className="btn ghost sm" disabled={!!busy} onClick={() => run('stored', { candidateId }, true)}>{busy === 'stored' ? 'Reading…' : 'Fill empty fields from resume'}</button>}
        <button className="btn ghost sm" disabled={!!busy} onClick={() => input.current?.click()}>{busy === 'upload' ? 'Uploading…' : resume ? 'Replace' : 'Attach resume'}</button>
        <input ref={input} type="file" accept=".pdf,.docx,.doc,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      </div>
      {msg && <p className={msg.error ? 'warn' : 'muted'} role="status">{msg.text}</p>}
    </section>
  );

  return (
    <section className="resume">
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{ai ? 'Fill from a resume' : 'Attach a resume'}</h3>
      {ai && <p className="muted" style={{ margin: '0 0 8px' }}>Upload a PDF or Word resume, or paste the text, and the profile fills in. The name, email and phone are read here; they aren’t sent to the AI.</p>}
      <label className="filepick"><input type="file" accept=".pdf,.docx,.doc,.txt" onChange={(e) => pick(e.target.files?.[0] ?? null)} /></label>
      {file && <p className="muted" style={{ margin: '4px 0' }}>{file.name} will be attached when you add the candidate.</p>}
      {ai && <>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste resume text" aria-label="Resume text" style={{ width: '100%', marginTop: 8 }} />
        <button className="btn ghost sm" disabled={!!busy || text.trim().length < 40} onClick={() => run('text', { text }, false)}>{busy === 'text' ? 'Reading…' : 'Fill from pasted text'}</button>
      </>}
      {busy === 'file' && <p className="muted">Reading the resume…</p>}
      {msg && <p className={msg.error ? 'warn' : 'muted'} role="status">{msg.text}</p>}
    </section>
  );
}
