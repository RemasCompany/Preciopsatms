'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Stage } from '@prisma/client';
import { useRecords } from './Records';
import { band, matchTone, type Factor } from '@/lib/match';
import { stageLabel } from '@/lib/pipeline';
import { sourceLabel } from '@/lib/boards';

type Ranked = { candidateId: string; name: string; title: string | null; location: string | null; status: string; applicationId: string | null; stage: Stage | null; source: string | null; flags: string[]; score: number; factors: Factor[]; matched: string[]; missing: string[] };
type JobRank = { job: { id: string; title: string; hasSkills: boolean; requiredCerts: string[] }; inPipeline: Ranked[]; prospects: Ranked[] };
type JobFit = { jobId: string; title: string; location: string | null; score: number; factors: Factor[]; missing: string[] };
type AiOpinion = Record<string, { score: number; reason: string }>;

async function call(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

export function ScorePill({ score }: { score: number }) {
  return <span className={`pill ${matchTone(score)}`} title={`${band(score)} — out of 100`}>{score}% match</span>;
}

/** Points per factor, so a recruiter can see why someone ranks where they do. */
function Breakdown({ factors, ai }: { factors: Factor[]; ai?: { score: number; reason: string } }) {
  return (
    <div className="mbreak">
      {factors.map((f) => (
        <div key={f.key} className="mfactor">
          <span className="mlabel">{f.label}</span>
          <span className="mtrack" aria-hidden><span style={{ width: `${(f.points / f.max) * 100}%` }} /></span>
          <span className="mpts">{Math.round(f.points)}/{f.max}</span>
          <span className="mnote muted">{f.note}</span>
        </div>
      ))}
      {ai && <div className="mai"><b>AI second opinion: {ai.score}</b> <span className="muted">{ai.reason}</span></div>}
    </div>
  );
}

function Row({ r, open, extra, ai }: { r: Ranked; open: (id: string) => void; extra?: React.ReactNode; ai?: { score: number; reason: string } }) {
  const [why, setWhy] = useState(false);
  return (
    <div className="mrow">
      <div className="li">
        <button className="link x" onClick={() => open(r.candidateId)}>
          <b>{r.name}</b>
          <span className="muted">{[r.title, r.location, r.source ? `via ${sourceLabel(r.source)}` : null].filter(Boolean).join(' · ') || 'No title or location yet'}</span>
        </button>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', margin: 0 }}>
          {r.flags.map((f) => <span key={f} className={`pill ${f === 'Do not return' ? 'r' : 'a'}`}>{f}</span>)}
          <button className="linkbtn" onClick={() => setWhy((w) => !w)} aria-expanded={why} aria-label={`Why ${r.name} scores ${r.score}`}><ScorePill score={r.score} /></button>
          {extra}
        </span>
      </div>
      {why && <Breakdown factors={r.factors} ai={ai} />}
    </div>
  );
}

/** On a job: its pipeline ranked best first, and the best people in the talent pool who aren't in it yet. */
export function JobMatches({ jobId, canEdit, reload }: { jobId: string; canEdit: boolean; reload: () => void }) {
  const { open, toast, ai, kind } = useRecords();
  const [data, setData] = useState<JobRank | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [opinion, setOpinion] = useState<AiOpinion>({});
  const load = useCallback(() => call(`/api/jobs/${jobId}/matches`).then(setData, (e) => setError((e as Error).message)), [jobId]);
  useEffect(() => { load(); }, [load]);
  const openCand = (id: string) => open('candidates', id);

  async function add(r: Ranked) {
    setAdding(r.candidateId);
    try { await call('/api/applications', 'POST', { jobId, candidateId: r.candidateId, stage: 'SOURCED' }); toast(`${r.name} added to the pipeline.`); await load(); reload(); }
    catch (e) { toast((e as Error).message, true); }
    setAdding('');
  }
  async function secondOpinion() {
    if (!data) return;
    setAiBusy(true);
    const ids = [...data.inPipeline.slice(0, 10), ...data.prospects.slice(0, 10)].map((r) => r.candidateId);
    try {
      const { matches } = await call('/api/ai/rank', 'POST', { jobId, candidateIds: ids }) as { matches: { id: string; score: number; reason: string }[] };
      setOpinion(Object.fromEntries(matches.map((m) => [m.id, { score: m.score, reason: m.reason }])));
      toast(matches.length ? 'AI second opinion added. Open a score to read it.' : 'The AI didn’t rate anyone 40 or higher for this job.');
    } catch (e) { toast((e as Error).message, true); }
    setAiBusy(false);
  }

  if (error) return <section className="sec"><h3>Best matches</h3><p className="muted">{error}</p></section>;
  if (!data) return <section className="sec"><h3>Best matches</h3><p className="muted">Ranking candidates…</p></section>;
  const { inPipeline, prospects } = data;
  return <>
    <section className="sec"><h3>Pipeline, best match first <a className="btn ghost sm" href={`/app/pipeline?job=${jobId}`}>Open board</a></h3>
      <div className="list">
        {inPipeline.map((r) => <Row key={r.candidateId} r={r} open={openCand} ai={opinion[r.candidateId]} extra={r.stage ? <span className="pill">{stageLabel(r.stage, kind)}</span> : null} />)}
        {!inPipeline.length && <p className="muted">No candidates yet.</p>}
      </div></section>
    <section className="sec"><h3>Best matches from your talent pool {ai && (inPipeline.length + prospects.length) > 0 && <button className="btn ghost sm" disabled={aiBusy} onClick={secondOpinion}>{aiBusy ? 'Asking…' : 'AI second opinion'}</button>}</h3>
      <p className="muted" style={{ marginTop: 0 }}>Scored out of 100 on skills (40), experience (15), role (15), certifications (10), location (10), pay (5) and availability (5). Open a score to see why. People on a do-not-return list are left out.{!data.job.hasSkills && ' Add skills to this job for a sharper ranking.'}</p>
      <div className="list">
        {prospects.map((r) => <Row key={r.candidateId} r={r} open={openCand} ai={opinion[r.candidateId]}
          extra={canEdit ? <button className="btn ghost sm" disabled={adding === r.candidateId} onClick={() => add(r)}>Add to pipeline</button> : null} />)}
        {!prospects.length && <p className="muted">Everyone active in your talent pool is already in this job’s pipeline, or you have no active candidates yet.</p>}
      </div></section>
  </>;
}

/** On a candidate: the open jobs they fit best. */
export function CandidateJobMatches({ candidateId, canEdit, reload }: { candidateId: string; canEdit: boolean; reload: () => void }) {
  const { open, toast } = useRecords();
  const [jobs, setJobs] = useState<JobFit[] | null>(null);
  const [why, setWhy] = useState('');
  const [adding, setAdding] = useState('');
  const load = useCallback(() => call(`/api/candidates/${candidateId}/matches`).then((j) => setJobs(j.jobs), () => setJobs([])), [candidateId]);
  useEffect(() => { load(); }, [load]);
  async function add(j: JobFit) {
    setAdding(j.jobId);
    try { await call('/api/applications', 'POST', { jobId: j.jobId, candidateId, stage: 'SOURCED' }); toast(`Added to ${j.title}.`); await load(); reload(); }
    catch (e) { toast((e as Error).message, true); }
    setAdding('');
  }
  if (!jobs || !jobs.length) return null;
  return (
    <section className="sec"><h3>Best jobs for this candidate</h3>
      <div className="list">{jobs.map((j) => (
        <div key={j.jobId} className="mrow">
          <div className="li">
            <button className="link x" onClick={() => open('jobs', j.jobId)}><b>{j.title}</b><span className="muted">{j.location ?? ''}</span></button>
            <span className="row" style={{ gap: 6 }}>
              <button className="linkbtn" onClick={() => setWhy((w) => (w === j.jobId ? '' : j.jobId))} aria-expanded={why === j.jobId} aria-label={`Why this job scores ${j.score}`}><ScorePill score={j.score} /></button>
              {canEdit && <button className="btn ghost sm" disabled={adding === j.jobId} onClick={() => add(j)}>Add to pipeline</button>}
            </span>
          </div>
          {why === j.jobId && <Breakdown factors={j.factors} />}
        </div>
      ))}</div>
    </section>
  );
}
