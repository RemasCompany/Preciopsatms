'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { REASON_LABEL, REFRESHER_TRIGGERS, STATUS_LABEL, MAX_RECERT_MONTHS, type Lesson, type Question, type Status } from '@/lib/training';

type Course = { id: string; title: string; certType: string; prerequisite: string | null; description: string | null; recertMonths: number; passScore: number; lessons: Lesson[]; questions: Question[]; questionCount: number; checklist: string[]; signup: string };
type Enrollment = {
  id: string; candidateId: string; name: string; course: string; certType: string; status: string; reason: string; trigger: string | null; dueDate: string | null; invited: boolean;
  lessonsDone: number; lessons: number; quizScore: number | null; attempts: number; checklist: string[]; evaluatedAt: string | null; evaluator: string | null; expiresAt: string | null; requestNote?: string | null;
};
type Due = { credentialId: string; candidateId: string; name: string; certType: string; expiresAt: string; expired: boolean; courseId: string };
type Operator = { id: string; candidateId: string; name: string; certType: string; expiresAt: string | null; verified: boolean; certificateId: string | null; onHold: boolean };
type Job = { id: string; title: string; client: string | null; requiredCerts: string[] };
type Template = { key: string; label: string; title: string; added: boolean };
type Props = { today: string; isAdmin: boolean; canEdit: boolean; certTypes: string[]; trainable: string[]; external: string[]; templates: Template[]; courses: Course[]; enrollments: Enrollment[]; due: Due[]; operators: Operator[]; jobs: Job[]; people: { id: string; name: string; status: string | null }[] };

const fmt = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const PILL: Record<string, string> = { requested: 'a', assigned: 'a', evaluation: 'a', certified: 'g', failed: 'r', cancelled: '' };
type Channels = ('sms' | 'email')[];

export default function TrainingBoard(p: Props) {
  const router = useRouter();
  const { toast, open } = useRecords();
  const [busy, setBusy] = useState(false);
  const call = async (url: string, method: string, body: object | undefined, done: string | ((j: Record<string, unknown>) => string)) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error ?? 'That didn’t work. Try again.', true); return null; }
      const problems = (j.problems as string[] | undefined) ?? [];
      toast([typeof done === 'string' ? done : done(j), ...problems].join(' '), problems.length > 0);
      router.refresh();
      return j;
    } catch { toast('Couldn’t reach the server. Try again.', true); return null; } finally { setBusy(false); }
  };

  const ready = p.enrollments.filter((e) => e.status === 'evaluation');
  const learning = p.enrollments.filter((e) => e.status === 'assigned');
  const requests = p.enrollments.filter((e) => e.status === 'requested');
  const closed = p.enrollments.filter((e) => ['certified', 'failed'].includes(e.status));
  const current = p.operators.filter((o) => o.verified && o.expiresAt && o.expiresAt >= p.today && !o.onHold).length;
  const edit = p.canEdit;

  return (
    <>
      <div className="kpis">
        <div className="kpi"><b>{learning.length}</b><span>Taking a course</span></div>
        <div className="kpi"><b>{ready.length}</b><span>Ready for evaluation</span></div>
        <div className="kpi"><b>{current}</b><span>Current certifications</span></div>
        <div className="kpi"><b>{p.due.length}</b><span>Due to recertify (60 days)</span></div>
      </div>

      {!p.courses.length && (
        <div className="card empty"><b>No courses yet</b>
          {p.isAdmin && edit ? <>Start with a ready-made course, then review it with your safety lead.
            <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>{p.templates.map((t) => <button key={t.key} className="btn" disabled={busy} onClick={() => call('/api/training/courses', 'POST', { template: t.key }, `${t.label} course added. Review the lessons and quiz below.`)}>Add the {t.label.toLowerCase()} course</button>)}</div></>
            : 'An owner or admin can add the first course.'}
        </div>
      )}

      {requests.length > 0 && (
        <section className="card"><h2 style={{ marginTop: 0 }}>Requests from employees</h2>
          <p className="muted">These employees asked to take a course from their employee page. Approving adds it to their training list.</p>
          <div className="list">{requests.map((e) => (
            <div key={e.id} className="li"><span className="x"><button className="linkish" onClick={() => open('candidates', e.candidateId)}><b>{e.name}</b></button><span className="muted">{e.course}{e.requestNote ? ` · “${e.requestNote}”` : ''}</span></span>
              {edit && <span style={{ whiteSpace: 'nowrap' }}><button className="btn sm" disabled={busy} onClick={() => call(`/api/training/enrollments/${e.id}`, 'PATCH', { action: 'approve' }, `Approved. ${e.name} can start ${e.course} from their employee page.`)}>Approve</button>{' '}
                <button className="btn ghost sm" disabled={busy} onClick={() => call(`/api/training/enrollments/${e.id}`, 'PATCH', { action: 'decline' }, 'Request declined.')}>Decline</button></span>}
            </div>
          ))}</div>
        </section>
      )}

      {ready.length > 0 && (
        <section className="card"><h2 style={{ marginTop: 0 }}>Ready for hands-on evaluation</h2>
          <p className="muted">These workers passed the online quiz. A qualified trainer now gives them practice on the truck and evaluates them where they’ll work. Record the result here.</p>
          {ready.map((e) => <EvaluationRow key={e.id} e={e} today={p.today} canEdit={edit} busy={busy} call={call} open={() => open('candidates', e.candidateId)} />)}
        </section>
      )}

      {p.courses.length > 0 && edit && <Assign courses={p.courses} people={p.people} busy={busy} call={call} />}

      {learning.length > 0 && (
        <section className="card"><h2 style={{ marginTop: 0 }}>Taking a course</h2>
          <div className="tablewrap"><table><thead><tr><th>Worker</th><th>Course</th><th>Progress</th><th>Due</th>{edit && <th />}</tr></thead><tbody>
            {learning.map((e) => (
              <tr key={e.id}>
                <td><button className="link" onClick={() => open('candidates', e.candidateId)}><b>{e.name}</b></button>{e.reason !== 'initial' && <div className="muted">{REASON_LABEL[e.reason]}{e.trigger ? `: ${e.trigger}` : ''}</div>}</td>
                <td>{e.course}</td>
                <td>{e.lessonsDone} of {e.lessons} lessons{e.attempts ? ` · quiz ${e.quizScore}% (${e.attempts} tr${e.attempts === 1 ? 'y' : 'ies'})` : ''}{!e.invited && <div className="warn">Link not sent</div>}</td>
                <td className={e.dueDate && e.dueDate < p.today ? 'warnnum' : undefined}>{fmt(e.dueDate)}</td>
                {edit && <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" disabled={busy} onClick={() => call(`/api/training/enrollments/${e.id}`, 'PATCH', { action: 'resend', channels: ['sms', 'email'] }, (j) => (j.sent ? `Sent ${e.name} a new link.` : `Couldn’t reach ${e.name}.`))}>Resend link</button>{' '}
                  <button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Cancel ${e.name}’s ${e.course} training?`) && call(`/api/training/enrollments/${e.id}`, 'PATCH', { action: 'cancel' }, 'Training cancelled.')}>Cancel</button>
                </td>}
              </tr>
            ))}
          </tbody></table></div>
        </section>
      )}

      {p.due.length > 0 && (
        <section className="card"><h2 style={{ marginTop: 0 }}>Due to recertify</h2>
          <p className="muted">Certifications that expire within 60 days (or already have), with no recertification under way. Operators must be evaluated at least every three years.</p>
          <div className="tablewrap"><table><thead><tr><th>Operator</th><th>Certification</th><th>Expires</th>{edit && <th />}</tr></thead><tbody>
            {p.due.map((d) => (
              <tr key={d.credentialId}>
                <td><button className="link" onClick={() => open('candidates', d.candidateId)}><b>{d.name}</b></button></td><td>{d.certType}</td>
                <td className={d.expired ? 'warnnum' : undefined}>{fmt(d.expiresAt)}{d.expired && <div className="warn">Expired</div>}</td>
                {edit && <td><button className="btn ghost sm" disabled={busy} onClick={() => call('/api/training/enrollments', 'POST', { courseId: d.courseId, candidateIds: [d.candidateId], reason: 'recert', dueDate: d.expired ? null : d.expiresAt, channels: ['sms', 'email'] }, `Recertification assigned to ${d.name}.`)}>Assign recertification</button></td>}
              </tr>
            ))}
          </tbody></table></div>
          {edit && p.due.length > 1 && <div className="row"><button className="btn ghost" disabled={busy} onClick={async () => {
            for (const [courseId, rows] of Object.entries(groupBy(p.due, (d) => d.courseId))) await call('/api/training/enrollments', 'POST', { courseId, candidateIds: rows.map((r) => r.candidateId), reason: 'recert', channels: ['sms', 'email'] }, (j) => `Recertification assigned to ${j.assigned} operator${j.assigned === 1 ? '' : 's'}.`);
          }}>Assign recertification to all {p.due.length}</button></div>}
        </section>
      )}

      <Operators operators={p.operators} courses={p.courses} today={p.today} canEdit={edit} busy={busy} call={call} open={(id) => open('candidates', id)} />

      {closed.length > 0 && (
        <section className="card"><h2 style={{ marginTop: 0 }}>Recent results</h2>
          <div className="tablewrap"><table><thead><tr><th>Worker</th><th>Course</th><th>Result</th><th>Evaluated</th><th /></tr></thead><tbody>
            {closed.map((e) => (
              <tr key={e.id}>
                <td><button className="link" onClick={() => open('candidates', e.candidateId)}><b>{e.name}</b></button><div className="muted">{REASON_LABEL[e.reason]}</div></td><td>{e.course}</td>
                <td><span className={`pill ${PILL[e.status]}`}>{STATUS_LABEL[e.status as Status]}</span>{e.expiresAt && <div className="muted">Until {fmt(e.expiresAt)}</div>}</td>
                <td>{fmt(e.evaluatedAt)}{e.evaluator && <div className="muted">{e.evaluator}</div>}</td>
                <td>{e.status === 'certified' && <a className="btn ghost sm" href={`/api/training/enrollments/${e.id}/certificate`} target="_blank" rel="noreferrer">Certificate</a>}</td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      )}

      {p.courses.length > 0 && <Courses courses={p.courses} certTypes={p.trainable} external={p.external} templates={p.templates} isAdmin={p.isAdmin} canEdit={edit} busy={busy} call={call} />}
      {p.isAdmin && <JobCerts jobs={p.jobs} certTypes={p.certTypes} canEdit={edit} busy={busy} call={call} />}
    </>
  );
}

type Call = (url: string, method: string, body: object | undefined, done: string | ((j: Record<string, unknown>) => string)) => Promise<Record<string, unknown> | null>;
const groupBy = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, T[]>>((m, x) => ({ ...m, [key(x)]: [...(m[key(x)] ?? []), x] }), {});

function EvaluationRow({ e, today, canEdit, busy, call, open }: { e: Enrollment; today: string; canEdit: boolean; busy: boolean; call: Call; open: () => void }) {
  const [form, setForm] = useState<null | { trainedAt: string; evaluatedAt: string; evaluatorName: string; evaluatorTitle: string; equipment: string; notes: string; checks: (boolean | null)[] }>(null);
  const allPass = form?.checks.every((c) => c === true);
  const answered = form?.checks.every((c) => c !== null);
  const submit = async (passed: boolean) => {
    if (!form) return;
    const ok = await call(`/api/training/enrollments/${e.id}`, 'PATCH', {
      action: 'evaluate', trainedAt: form.trainedAt, evaluatedAt: form.evaluatedAt, evaluatorName: form.evaluatorName, evaluatorTitle: form.evaluatorTitle, equipment: form.equipment,
      notes: form.notes || undefined, passed, checklist: e.checklist.map((item, i) => ({ item, pass: form.checks[i] === true })),
    }, (j) => (j.certified ? `${e.name} is certified until ${fmt(j.expiresAt as string)}.` : `Recorded: ${e.name} didn’t pass. Assign the course again when they’re ready.`));
    if (ok) setForm(null);
  };
  return (
    <div className="li" style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
        <span><button className="link" onClick={open}><b>{e.name}</b></button> <span className="muted">· {e.course} · quiz {e.quizScore}%{e.reason !== 'initial' ? ` · ${REASON_LABEL[e.reason]}` : ''}</span></span>
        {canEdit && !form && <button className="btn sm" onClick={() => setForm({ trainedAt: today, evaluatedAt: today, evaluatorName: '', evaluatorTitle: '', equipment: '', notes: '', checks: e.checklist.map(() => null) })}>Record evaluation</button>}
      </div>
      {form && (
        <div className="subform">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>Hands-on training on<input type="date" max={today} value={form.trainedAt} onChange={(x) => setForm({ ...form, trainedAt: x.target.value })} /></label>
            <label>Evaluated on<input type="date" max={today} value={form.evaluatedAt} onChange={(x) => setForm({ ...form, evaluatedAt: x.target.value })} /></label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>Trainer / evaluator<input value={form.evaluatorName} maxLength={120} onChange={(x) => setForm({ ...form, evaluatorName: x.target.value })} placeholder="Full name" /></label>
            <label>Their qualification<input value={form.evaluatorTitle} maxLength={160} onChange={(x) => setForm({ ...form, evaluatorTitle: x.target.value })} placeholder="e.g. Site safety lead, certified forklift trainer" /></label>
          </div>
          <label>Equipment used<input value={form.equipment} maxLength={160} onChange={(x) => setForm({ ...form, equipment: x.target.value })} placeholder="Make, model and type, e.g. Toyota 8FGCU25 or Genie GS-1930" /></label>
          <fieldset><legend>Practical evaluation</legend>
            {e.checklist.map((item, i) => (
              <div key={i} className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <span>{item}</span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  <label className="check" style={{ display: 'inline' }}><input type="radio" name={`${e.id}-${i}`} checked={form.checks[i] === true} onChange={() => setForm({ ...form, checks: form.checks.map((c, k) => (k === i ? true : c)) })} /> Pass</label>{' '}
                  <label className="check" style={{ display: 'inline' }}><input type="radio" name={`${e.id}-${i}`} checked={form.checks[i] === false} onChange={() => setForm({ ...form, checks: form.checks.map((c, k) => (k === i ? false : c)) })} /> Not yet</label>
                </span>
              </div>
            ))}
          </fieldset>
          <label>Notes (optional)<textarea rows={2} maxLength={2000} value={form.notes} onChange={(x) => setForm({ ...form, notes: x.target.value })} /></label>
          <div className="row">
            <button className="btn" disabled={busy || !allPass} title={allPass ? undefined : 'Every item must pass to certify'} onClick={() => submit(true)}>Passed — certify</button>
            <button className="btn danger" disabled={busy || !answered} onClick={() => submit(false)}>Didn’t pass</button>
            <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Assign({ courses, people, busy, call }: { courses: Course[]; people: Props['people']; busy: boolean; call: Call }) {
  const [opened, setOpened] = useState(false);
  const [courseId, setCourseId] = useState(courses[0].id);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [onlyActive, setOnlyActive] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const [channels, setChannels] = useState<Channels>(['sms', 'email']);
  const shown = useMemo(() => people.filter((x) => (!onlyActive || x.status === 'On assignment' || picked.has(x.id)) && x.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 100), [people, q, onlyActive, picked]);
  if (!opened) return <p><button className="btn ghost" onClick={() => setOpened(true)}>+ Assign training</button></p>;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <section className="card subform"><h2 style={{ marginTop: 0 }}>Assign training</h2>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label>Course<select value={courseId} onChange={(e) => setCourseId(e.target.value)}>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label>Finish by (optional)<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      </div>
      <label>Find workers<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" /></label>
      <label className="check"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Only people on assignment</label>
      <div className="list" style={{ maxHeight: 240, overflow: 'auto' }}>
        {shown.map((x) => <label key={x.id} className="check li"><input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} /> {x.name}{x.status ? <span className="muted"> · {x.status}</span> : null}</label>)}
        {!shown.length && <p className="muted">No one matches.</p>}
      </div>
      <p className="muted">Send their private link by{' '}
        {(['sms', 'email'] as const).map((c) => <label key={c} className="check" style={{ display: 'inline', marginRight: 10 }}><input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))} /> {c === 'sms' ? 'text' : 'email'}</label>)}
      </p>
      <div className="row">
        <button className="btn" disabled={busy || !picked.size} onClick={async () => {
          const j = await call('/api/training/enrollments', 'POST', { courseId, candidateIds: [...picked], dueDate: dueDate || null, channels }, (r) => `Assigned to ${r.assigned} worker${r.assigned === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already taking it)` : ''}.`);
          if (j) { setPicked(new Set()); setOpened(false); }
        }}>Assign to {picked.size || '…'}</button>
        <button className="btn ghost" onClick={() => setOpened(false)}>Close</button>
      </div>
    </section>
  );
}

function Operators({ operators, courses, today, canEdit, busy, call, open }: { operators: Operator[]; courses: Course[]; today: string; canEdit: boolean; busy: boolean; call: Call; open: (id: string) => void }) {
  const [refresher, setRefresher] = useState<{ op: Operator; courseId: string; trigger: string; note: string } | null>(null);
  if (!operators.length) return null;
  return (
    <section className="card"><h2 style={{ marginTop: 0 }}>Certified operators</h2>
      <div className="tablewrap"><table><thead><tr><th>Operator</th><th>Certification</th><th>Status</th><th /></tr></thead><tbody>
        {operators.map((o) => {
          const expired = !!o.expiresAt && o.expiresAt < today;
          const courseIds = courses.filter((c) => c.certType === o.certType);
          return (
            <tr key={o.id}>
              <td><button className="link" onClick={() => open(o.candidateId)}><b>{o.name}</b></button></td><td>{o.certType}</td>
              <td>{o.onHold ? <span className="pill r">On hold: refresher</span> : expired ? <span className="pill r">Expired {fmt(o.expiresAt)}</span> : !o.verified ? <span className="pill a">Not verified</span> : <span className="pill g">Until {fmt(o.expiresAt)}</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {o.certificateId && <a className="btn ghost sm" href={`/api/training/enrollments/${o.certificateId}/certificate`} target="_blank" rel="noreferrer">Certificate</a>}{' '}
                {canEdit && !o.onHold && courseIds.length > 0 && <button className="btn ghost sm" onClick={() => setRefresher({ op: o, courseId: courseIds[0].id, trigger: '', note: '' })}>Require refresher</button>}
              </td>
            </tr>
          );
        })}
      </tbody></table></div>
      {refresher && (
        <div className="subform">
          <p><b>Refresher training for {refresher.op.name}</b><br /><span className="muted">Their {refresher.op.certType} certification is on hold — they can’t be placed or scheduled on jobs that need it without an admin override — until they retake the course and pass a new evaluation.</span></p>
          <label>Why<select value={refresher.trigger} onChange={(e) => setRefresher({ ...refresher, trigger: e.target.value })}><option value="" disabled>Choose…</option>{REFRESHER_TRIGGERS.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Details (optional)<input value={refresher.note} maxLength={500} onChange={(e) => setRefresher({ ...refresher, note: e.target.value })} placeholder="e.g. Clipped a rack end, Dock 3, Oct 12" /></label>
          {courses.filter((c) => c.certType === refresher.op.certType).length > 1 && <label>Course<select value={refresher.courseId} onChange={(e) => setRefresher({ ...refresher, courseId: e.target.value })}>{courses.filter((c) => c.certType === refresher.op.certType).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
          <div className="row">
            <button className="btn" disabled={busy || !refresher.trigger} onClick={async () => { if (await call('/api/training/refresher', 'POST', { candidateId: refresher.op.candidateId, courseId: refresher.courseId, trigger: refresher.trigger, note: refresher.note || undefined, channels: ['sms', 'email'] }, `Refresher assigned; ${refresher.op.name}’s certification is on hold.`)) setRefresher(null); }}>Require refresher</button>
            <button className="btn ghost" onClick={() => setRefresher(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Courses({ courses, certTypes, external, templates, isAdmin, canEdit, busy, call }: { courses: Course[]; certTypes: string[]; external: string[]; templates: Template[]; isAdmin: boolean; canEdit: boolean; busy: boolean; call: Call }) {
  const [editing, setEditing] = useState<(Course & { checklistText: string }) | null>(null);
  const blank = (): Course & { checklistText: string } => ({ id: '', title: '', certType: certTypes[0], prerequisite: null, description: '', recertMonths: MAX_RECERT_MONTHS, passScore: 80, lessons: [{ title: '', body: '', videoUrl: '' }], questions: [{ q: '', choices: ['', '', '', ''], answer: 0 }], questionCount: 0, checklist: [], checklistText: '', signup: 'none' });
  const save = async () => {
    if (!editing) return;
    const body = { title: editing.title, certType: editing.certType, prerequisite: editing.prerequisite || null, description: editing.description || null, recertMonths: editing.recertMonths, passScore: editing.passScore,
      lessons: editing.lessons.map((l) => ({ ...l, videoUrl: l.videoUrl || null })), questions: editing.questions.map((q) => ({ ...q, choices: q.choices.filter((c) => c.trim()) })),
      checklist: editing.checklistText.split('\n').map((x) => x.trim()).filter(Boolean), signup: editing.signup };
    if (await call(editing.id ? `/api/training/courses/${editing.id}` : '/api/training/courses', editing.id ? 'PATCH' : 'POST', body, 'Course saved.')) setEditing(null);
  };
  const set = (patch: Partial<Course & { checklistText: string }>) => setEditing((e) => (e ? { ...e, ...patch } : e));
  return (
    <section className="card"><h2 style={{ marginTop: 0 }}>Courses {isAdmin && canEdit && !editing && <button className="btn ghost sm" onClick={() => setEditing(blank())}>+ New course</button>}</h2>
      {!editing && (
        <div className="list">{courses.map((c) => (
          <div key={c.id} className="li"><span className="x"><b>{c.title}</b><span className="muted">Issues “{c.certType}”{c.prerequisite ? ` · requires a current ${c.prerequisite}` : ''} · {c.lessons.length} lessons · {c.questionCount} quiz questions (pass {c.passScore}%) · recertify every {c.recertMonths} months{c.signup === 'open' ? ' · employees can sign up' : c.signup === 'approval' ? ' · employees can ask to take it' : ''}</span></span>
            {isAdmin && canEdit && <span style={{ whiteSpace: 'nowrap' }}><button className="btn ghost sm" onClick={() => setEditing({ ...c, checklistText: c.checklist.join('\n') })}>Edit</button>{' '}
              <button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Remove “${c.title}”? Courses with training records are archived, not deleted.`) && call(`/api/training/courses/${c.id}`, 'DELETE', undefined, (j) => (j.archived ? 'Course archived.' : 'Course deleted.'))}>Remove</button></span>}
          </div>
        ))}</div>
      )}
      {!editing && isAdmin && canEdit && templates.some((t) => !t.added) && (
        <p className="muted">Add a ready-made course:{' '}{templates.filter((t) => !t.added).map((t) => <button key={t.key} className="btn ghost sm" style={{ marginRight: 6 }} disabled={busy} onClick={() => call('/api/training/courses', 'POST', { template: t.key }, `${t.label} course added.`)}>{t.label}</button>)}</p>
      )}
      {!isAdmin && <p className="muted">Owners and admins can edit courses.</p>}
      {editing && (
        <div className="subform">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label style={{ flex: 2 }}>Course name<input value={editing.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} /></label>
            <label style={{ flex: 2 }}>Certification it issues<select value={editing.certType} onChange={(e) => set({ certType: e.target.value })}>{certTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>Recertify every (months)<input type="number" min={1} max={MAX_RECERT_MONTHS} value={editing.recertMonths} onChange={(e) => set({ recertMonths: Number(e.target.value) })} /></label>
            <label>Passing quiz score (%)<input type="number" min={50} max={100} value={editing.passScore} onChange={(e) => set({ passScore: Number(e.target.value) })} /></label>
          </div>
          <label>Must already hold (issued outside the company)<select value={editing.prerequisite ?? ''} onChange={(e) => set({ prerequisite: e.target.value || null })}><option value="">Nothing</option>{external.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Description<textarea rows={2} maxLength={2000} value={editing.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></label>
          <label>Employee sign-up<select value={editing.signup} onChange={(e) => set({ signup: e.target.value })}>
            <option value="none">Assigned by the team only</option><option value="open">Employees can sign up from their page</option><option value="approval">Employees can ask; a manager approves</option></select></label>
          <h3>Lessons</h3>
          {editing.lessons.map((l, i) => (
            <fieldset key={i}><legend>Lesson {i + 1}</legend>
              <label>Title<input value={l.title} maxLength={120} onChange={(e) => set({ lessons: editing.lessons.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} /></label>
              <label>Text<textarea rows={5} maxLength={8000} value={l.body} onChange={(e) => set({ lessons: editing.lessons.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)) })} /></label>
              <label>Video link (optional)<input value={l.videoUrl ?? ''} placeholder="https://…" onChange={(e) => set({ lessons: editing.lessons.map((x, k) => (k === i ? { ...x, videoUrl: e.target.value } : x)) })} /></label>
              {editing.lessons.length > 1 && <button className="btn ghost sm" onClick={() => set({ lessons: editing.lessons.filter((_, k) => k !== i) })}>Remove lesson</button>}
            </fieldset>
          ))}
          <p><button className="btn ghost sm" onClick={() => set({ lessons: [...editing.lessons, { title: '', body: '', videoUrl: '' }] })}>+ Lesson</button></p>
          <h3>Quiz</h3>
          {editing.questions.map((q, i) => (
            <fieldset key={i}><legend>Question {i + 1}</legend>
              <label>Question<input value={q.q} maxLength={400} onChange={(e) => set({ questions: editing.questions.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)) })} /></label>
              {q.choices.map((c, j) => (
                <div key={j} className="row" style={{ marginTop: 4 }}>
                  <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="radio" name={`q${i}`} checked={q.answer === j} onChange={() => set({ questions: editing.questions.map((x, k) => (k === i ? { ...x, answer: j } : x)) })} /> Correct</label>
                  <input style={{ flex: 1 }} value={c} maxLength={200} placeholder={`Choice ${j + 1}`} onChange={(e) => set({ questions: editing.questions.map((x, k) => (k === i ? { ...x, choices: x.choices.map((y, m) => (m === j ? e.target.value : y)) } : x)) })} />
                </div>
              ))}
              {editing.questions.length > 1 && <button className="btn ghost sm" onClick={() => set({ questions: editing.questions.filter((_, k) => k !== i) })}>Remove question</button>}
            </fieldset>
          ))}
          <p><button className="btn ghost sm" onClick={() => set({ questions: [...editing.questions, { q: '', choices: ['', '', '', ''], answer: 0 }] })}>+ Question</button></p>
          <label>Hands-on evaluation checklist (one item per line)<textarea rows={6} value={editing.checklistText} onChange={(e) => set({ checklistText: e.target.value })} /></label>
          <p className="muted">Changing the checklist doesn’t affect evaluations already recorded. Workers taking the course see lesson and quiz changes right away.</p>
          <div className="row"><button className="btn" disabled={busy} onClick={save}>Save course</button><button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}

function JobCerts({ jobs, certTypes, canEdit, busy, call }: { jobs: Job[]; certTypes: string[]; canEdit: boolean; busy: boolean; call: Call }) {
  const [edit, setEdit] = useState<{ id: string; certs: string[] } | null>(null);
  if (!jobs.length) return null;
  return (
    <section className="card"><h2 style={{ marginTop: 0 }}>Jobs that need a certification</h2>
      <p className="muted">Offering, placing or scheduling someone on these jobs without a current certification is stopped. An owner or admin can override with a reason, which is saved in the audit log. Open shifts are only offered to certified workers.</p>
      <div className="list">{jobs.map((j) => (
        <div key={j.id} className="li" style={{ display: 'block' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
            <span><b>{j.title}</b>{j.client && <span className="muted"> · {j.client}</span>}<div className="muted">{j.requiredCerts.length ? j.requiredCerts.join(', ') : 'No certification required'}</div></span>
            {canEdit && edit?.id !== j.id && <button className="btn ghost sm" onClick={() => setEdit({ id: j.id, certs: j.requiredCerts })}>Change</button>}
          </div>
          {edit?.id === j.id && (
            <div className="subform">
              {certTypes.map((t) => <label key={t} className="check"><input type="checkbox" checked={edit.certs.includes(t)} onChange={(e) => setEdit({ ...edit, certs: e.target.checked ? [...edit.certs, t] : edit.certs.filter((x) => x !== t) })} /> {t}</label>)}
              <div className="row"><button className="btn sm" disabled={busy} onClick={async () => { if (await call(`/api/training/jobs/${j.id}`, 'PATCH', { requiredCerts: edit.certs }, 'Saved.')) setEdit(null); }}>Save</button><button className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button></div>
            </div>
          )}
        </div>
      ))}</div>
    </section>
  );
}
