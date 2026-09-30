import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature, planIncludes } from '@/lib/plans';
import { hasBlanks } from '@/lib/merge';
import { i9Due, progress } from '@/lib/onboarding';
import { recompute, verifiedTypes } from '@/lib/onboarding-server';
import { OnboardingDetail } from '@/components/Onboarding';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function OnboardingPage({ params }: { params: { id: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'onboarding')) return <Gate title="Onboarding" feature="New-hire onboarding" off={planIncludes(ctx.org, 'onboarding')} />;
  await recompute(ctx.tdb, params.id); // a credential may have been verified since
  const ob = await ctx.tdb.onboarding.findFirst({ where: { id: params.id }, include: { steps: { orderBy: { position: 'asc' } }, application: { include: { candidate: true, job: { select: { title: true, client: { select: { name: true } } } } } } } });
  if (!ob) notFound();
  const types = await verifiedTypes(ctx.tdb, ob.candidateId);
  const p = progress(ob.steps.map((s) => ({ ...s, config: (s.config ?? {}) as Record<string, unknown> })), types);
  const docs = await ctx.tdb.signDocument.findMany({ where: { id: { in: ob.steps.map((s) => s.signDocumentId).filter(Boolean) as string[] } }, select: { id: true, status: true, body: true, signedAt: true } });
  const c = ob.application.candidate;
  return (
    <>
      <p className="muted" style={{ margin: 0 }}><Link href="/app/onboarding">← Onboarding</Link></p>
      <OnboardingDetail
        ob={{ id: ob.id, status: ob.status, packageName: ob.packageName, startDate: ob.startDate ? ymd(ob.startDate) : null, invitedAt: ob.invitedAt?.toISOString() ?? null, completedAt: ob.completedAt?.toISOString() ?? null,
          candidateId: c.id, name: c.name, job: [ob.application.job.title, ob.application.job.client?.name].filter(Boolean).join(' — '),
          canText: !!c.phone && !c.smsOptOut, canEmail: !!c.email && !c.emailOptOut, done: p.done, total: p.total, ready: p.ready,
          i9Due: ob.startDate ? i9Due(ymd(ob.startDate)) : null }}
        steps={ob.steps.map((s) => {
          const d = docs.find((x) => x.id === s.signDocumentId);
          return {
            id: s.id, kind: s.kind, label: s.label, hint: s.hint, required: s.required, status: s.status, auto: p.isDone({ ...s, config: (s.config ?? {}) as Record<string, unknown> }) && s.status === 'PENDING',
            task: (s.config as { task?: string }).task ?? null, credentialType: (s.config as { credentialType?: string }).credentialType ?? null,
            completedAt: s.completedAt?.toISOString() ?? null, byWorker: s.completedBy === 'worker', note: s.note, hasFile: !!s.fileId,
            contact: s.kind === 'FORM' && s.data ? (s.data as Record<string, string>) : null,
            doc: d ? { id: d.id, status: d.status, blanks: d.status !== 'SIGNED' && hasBlanks(d.body) } : null,
          };
        })}
        canEdit={canEdit(ctx)} />
    </>
  );
}
