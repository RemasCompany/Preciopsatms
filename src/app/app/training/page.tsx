import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { localDate } from '@/lib/timeclock';
import { recertDue } from '@/lib/training-server';
import { EQUIPMENT_TYPES, EXTERNAL_TYPES, OPEN_STATUSES, TRAINABLE_TYPES, type Lesson, type Question } from '@/lib/training';
import { TEMPLATES } from '@/lib/training-templates';
import TrainingBoard from '@/components/Training';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function Training() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'training')) return <Gate title="Training" feature="Equipment operator training" />;
  const { tdb } = ctx;
  const admin = ctx.role === 'OWNER' || ctx.role === 'ADMIN';
  const today = localDate(new Date(), ctx.org.timezone);
  const since = new Date(Date.now() - 90 * 864e5);
  const [courses, enrollments, due, jobs, people, creds] = await Promise.all([
    tdb.trainingCourse.findMany({ where: { archived: false }, orderBy: { title: 'asc' } }),
    tdb.trainingEnrollment.findMany({ where: { OR: [{ status: { in: OPEN_STATUSES } }, { updatedAt: { gte: since } }] }, include: { candidate: { select: { name: true } }, course: { select: { title: true, certType: true, lessons: true, checklist: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
    recertDue(tdb, today),
    tdb.job.findMany({ where: { status: { in: ['OPEN', 'ON_HOLD'] } }, select: { id: true, title: true, requiredCerts: true, client: { select: { name: true } } }, orderBy: { title: 'asc' }, take: 300 }),
    tdb.candidate.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: 'asc' }, take: 3000 }),
    tdb.credential.findMany({ where: { type: { in: EQUIPMENT_TYPES } }, include: { candidate: { select: { name: true } } }, orderBy: { expiresAt: 'asc' } }),
  ]);
  const certified = await tdb.trainingEnrollment.findMany({ where: { status: 'certified', credentialId: { in: creds.map((c) => c.id) } }, select: { id: true, credentialId: true }, orderBy: { certifiedAt: 'desc' } });
  const holds = enrollments.filter((e) => e.reason === 'refresher' && OPEN_STATUSES.includes(e.status as never));
  return (
    <>
      <h1>Training</h1>
      <p className="lede">Train and certify equipment operators — forklifts, aerial lifts and crane operator evaluations: online lessons and a quiz on the worker’s phone, then a hands-on evaluation that issues the certification. Recertify on schedule, and require refresher training after an incident.</p>
      <TrainingBoard
        today={today} isAdmin={admin} canEdit={canEdit(ctx)} certTypes={EQUIPMENT_TYPES} trainable={TRAINABLE_TYPES} external={EXTERNAL_TYPES}
        templates={Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, title: t.course.title, added: courses.some((c) => c.title === t.course.title) }))}
        courses={courses.map((c) => ({ id: c.id, title: c.title, certType: c.certType, prerequisite: c.prerequisite, description: c.description, recertMonths: c.recertMonths, passScore: c.passScore,
          lessons: c.lessons as Lesson[], questions: admin ? (c.questions as Question[]) : [], questionCount: (c.questions as Question[]).length, checklist: c.checklist as string[] }))}
        enrollments={enrollments.map((e) => ({
          id: e.id, candidateId: e.candidateId, name: e.candidate.name, course: e.course.title, certType: e.course.certType, status: e.status, reason: e.reason, trigger: e.trigger,
          dueDate: ymd(e.dueDate), invited: !!e.invitedAt, lessonsDone: e.lessonsDone.length, lessons: (e.course.lessons as Lesson[]).length, quizScore: e.quizScore, attempts: e.quizAttempts,
          checklist: e.course.checklist as string[], evaluatedAt: ymd(e.evaluatedAt), evaluator: e.evaluatorName, expiresAt: ymd(e.expiresAt),
        }))}
        due={due}
        operators={creds.map((c) => ({
          id: c.id, candidateId: c.candidateId, name: c.candidate.name, certType: c.type, expiresAt: ymd(c.expiresAt), verified: !!c.verifiedAt,
          certificateId: certified.find((x) => x.credentialId === c.id)?.id ?? null,
          onHold: holds.some((h) => h.candidateId === c.candidateId && h.course.certType === c.type),
        }))}
        jobs={jobs.map((j) => ({ id: j.id, title: j.title, client: j.client?.name ?? null, requiredCerts: j.requiredCerts }))}
        people={people}
      />
    </>
  );
}
