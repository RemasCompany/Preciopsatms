import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { renderTrainingCertificate } from '@/lib/pdf';
import { REASON_LABEL } from '@/lib/training';

const ymd = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null;
const long = (d: Date | null) => d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

/** The operator's certificate (PDF), for anyone on the team. */
export const GET = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org } = await requireApiContext({ feature: 'training' });
  const e = await tdb.trainingEnrollment.findFirst({ where: { id: params.id, status: 'certified' }, include: { course: true, candidate: { select: { name: true } } } });
  if (!e) throw new HttpError(404, 'There’s no certificate for this training.');
  const bytes = await renderTrainingCertificate({
    company: org.name, operator: e.candidate.name, course: e.course.title, certType: e.course.certType, equipment: e.equipment ?? '', reason: REASON_LABEL[e.reason] ?? e.reason,
    quizPassed: e.quizPassedAt ? long(new Date(`${ymd(e.quizPassedAt)}T00:00:00Z`)) : null, quizScore: e.quizScore,
    trainedAt: long(e.trainedAt), evaluatedAt: long(e.evaluatedAt), evaluator: e.evaluatorName ?? '', evaluatorTitle: e.evaluatorTitle ?? '', expiresAt: long(e.expiresAt),
    checklist: (e.checklist as { item: string; pass: boolean }[] | null) ?? [], id: e.id,
  });
  const file = `${e.candidate.name.replace(/[^\w]+/g, '-')}-${e.course.certType.replace(/[^\w]+/g, '-')}-certificate.pdf`.toLowerCase();
  return new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file}"`, 'Cache-Control': 'private, no-store' } });
});
