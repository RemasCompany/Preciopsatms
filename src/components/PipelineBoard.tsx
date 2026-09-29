'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Stage } from '@prisma/client';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { BOARD_STAGES, START_STAGES, REJECTION_REASONS, stageLabel, type RejectionReason } from '@/lib/pipeline';

export type BoardApp = {
  id: string; jobId: string; candidateId: string; stage: Stage; matchScore: number | null; stageChangedAt: string;
  candidate: string; availability: string | null; job: string; client: string | null;
};
type JobOpt = { id: string; title: string; client: string | null; open: boolean };
type CandOpt = { id: string; name: string; title: string | null };

const daysIn = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
const jobLabel = (j: JobOpt) => (j.client ? `${j.title} — ${j.client}` : j.title);

export default function PipelineBoard({ apps: initial, jobs, candidates, initialJob, canEdit }: {
  apps: BoardApp[]; jobs: JobOpt[]; candidates: CandOpt[]; initialJob: string; canEdit: boolean;
}) {
  const router = useRouter();
  const { open } = useRecords();
  const [apps, setApps] = useState(initial);
  const [q, setQ] = useState('');
  const [job, setJob] = useState(initialJob);
  const [over, setOver] = useState<Stage | null>(null);
  const [rejecting, setRejecting] = useState<BoardApp | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setApps(initial), [initial]);
  const say = (text: string, error = false) => {
    setToast({ text, error }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), text.length > 90 ? 9000 : 3500);
  };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return apps.filter((a) => (!job || a.jobId === job) && (!needle || `${a.candidate} ${a.job} ${a.client ?? ''}`.toLowerCase().includes(needle)));
  }, [apps, q, job]);

  function chooseJob(id: string) {
    setJob(id);
    const u = new URL(window.location.href); if (id) u.searchParams.set('job', id); else u.searchParams.delete('job');
    window.history.replaceState(null, '', u);
  }

  async function move(a: BoardApp, stage: Stage, rejectionReason?: RejectionReason) {
    if (!canEdit || a.stage === stage) return;
    if (stage === 'REJECTED' && !rejectionReason) { setRejecting(a); return; }
    const before = apps;
    setApps((xs) => xs.map((x) => (x.id === a.id ? { ...x, stage, stageChangedAt: new Date().toISOString() } : x)));
    const res = await fetch(`/api/applications/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, rejectionReason }) });
    if (!res.ok) { setApps(before); say((await res.json().catch(() => ({}))).error ?? 'Could not move this candidate. Try again.', true); return; }
    const j = await res.json().catch(() => ({}));
    if (stage === 'PLACED') { if (j.warning) say(j.warning, true); else say(`${a.candidate} placed. Nice work.`); router.refresh(); }
    else if (stage === 'REJECTED') say(`${a.candidate} rejected: ${rejectionReason}.`);
  }

  function onKey(e: React.KeyboardEvent, a: BoardApp) {
    if (e.key === 'Enter') { open('candidates', a.candidateId); return; }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = BOARD_STAGES.indexOf(a.stage) + (e.key === 'ArrowRight' ? 1 : -1);
    if (i >= 0 && i < BOARD_STAGES.length) move(a, BOARD_STAGES[i]);
  }

  return (
    <>
      <div className="bar">
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by candidate or job…" aria-label="Filter by candidate or job" />
        <select value={job} onChange={(e) => chooseJob(e.target.value)} aria-label="Job">
          <option value="">All jobs</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{jobLabel(j)}</option>)}
        </select>
        {canEdit && <button className="btn" onClick={() => setAdding(true)}>+ Add to pipeline</button>}
      </div>

      {apps.length === 0 ? (
        <div className="card empty"><b>No one in the pipeline yet</b>Add candidates to a job and they’ll appear here as cards you can drag through each stage.</div>
      ) : (
        <div className="board" role="list" aria-label="Pipeline stages">
          {BOARD_STAGES.map((s, i) => {
            const items = visible.filter((a) => a.stage === s);
            return (
              <section key={s} role="listitem" aria-label={`${stageLabel(s)}, ${items.length}`} className={`col${over === s ? ' over' : ''}`} style={{ '--c': `var(--s${i})` } as React.CSSProperties}
                onDragOver={(e) => { if (!canEdit) return; e.preventDefault(); setOver(s); }}
                onDragLeave={() => setOver((o) => (o === s ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); const a = apps.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (a) move(a, s); }}>
                <h3><span>{stageLabel(s)}</span><small>{items.length}</small></h3>
                {items.map((a) => {
                  const d = daysIn(a.stageChangedAt);
                  return (
                    <div key={a.id} className="cardk" tabIndex={0} draggable={canEdit}
                      aria-label={`${a.candidate}, ${a.job}. ${canEdit ? 'Enter opens the candidate; left and right arrow keys change stage.' : 'Enter opens the candidate.'}`}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onKeyDown={(e) => onKey(e, a)} onClick={() => open('candidates', a.candidateId)}>
                      <b>{a.candidate}</b>
                      <span className="muted">{a.job}{a.client ? ` · ${a.client}` : ''}</span>
                      <div className="meta"><span>{a.matchScore ? `Match ${a.matchScore}` : a.availability ?? ''}</span><span>{d ? `${d}d in stage` : 'today'}</span></div>
                      {canEdit && (
                        <select className="movesel" aria-label={`Move ${a.candidate} to stage`} value={a.stage}
                          onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => move(a, e.target.value as Stage)}>
                          {BOARD_STAGES.map((st) => <option key={st} value={st}>{st === a.stage ? `In ${stageLabel(st)}` : `Move to ${stageLabel(st)}`}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      {rejecting && (
        <Drawer title={rejecting.candidate} kicker="Reject" onClose={() => setRejecting(null)}>
          <p className="muted">Record why, so your applicant flow log is complete for EEO reporting.</p>
          <div className="list">
            {REJECTION_REASONS.map((r) => (
              <button key={r} className="li link" onClick={() => { const a = rejecting; setRejecting(null); move(a, 'REJECTED', r); }}><b>{r}</b></button>
            ))}
          </div>
        </Drawer>
      )}

      {adding && (
        <AddToPipeline jobs={jobs.filter((j) => j.open)} candidates={candidates} defaultJob={job} apps={apps}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); say('Added to pipeline.'); router.refresh(); }} />
      )}

      {toast && <div className={`toast${toast.error ? ' bad' : ''}`} role="status">{toast.text}</div>}
    </>
  );
}

function AddToPipeline({ jobs, candidates, defaultJob, apps, onClose, onAdded }: {
  jobs: JobOpt[]; candidates: CandOpt[]; defaultJob: string; apps: BoardApp[]; onClose: () => void; onAdded: () => void;
}) {
  const [jobId, setJobId] = useState(jobs.some((j) => j.id === defaultJob) ? defaultJob : jobs[0]?.id ?? '');
  const [candidateId, setCandidateId] = useState(candidates[0]?.id ?? '');
  const [stage, setStage] = useState<Stage>('SOURCED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add() {
    setError('');
    if (!jobId) return setError('Add an open job first.');
    if (!candidateId) return setError('Add a candidate first.');
    if (apps.some((a) => a.jobId === jobId && a.candidateId === candidateId)) return setError('Already in this job’s pipeline.');
    setBusy(true);
    const res = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, candidateId, stage }) });
    setBusy(false);
    if (res.ok) onAdded(); else setError((await res.json().catch(() => ({}))).error ?? 'Could not add. Try again.');
  }

  return (
    <Drawer title="Add to pipeline" onClose={onClose} footer={<>
      <button className="btn" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add to pipeline'}</button>
      <a className="btn ghost" href="/app/candidates">New candidate instead</a>
    </>}>
      <label>Job<select value={jobId} onChange={(e) => setJobId(e.target.value)}>
        {jobs.length ? jobs.map((j) => <option key={j.id} value={j.id}>{jobLabel(j)}</option>) : <option value="">No open jobs</option>}
      </select></label>
      <label>Candidate<select value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
        {candidates.length ? candidates.map((c) => <option key={c.id} value={c.id}>{c.title ? `${c.name} — ${c.title}` : c.name}</option>) : <option value="">No candidates yet</option>}
      </select></label>
      <label>Starting stage<select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
        {START_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
      </select></label>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}
