import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { i9Due, progress } from '@/lib/onboarding';
import { verifiedTypes } from '@/lib/onboarding-server';
import { StartOnboarding } from '@/components/Onboarding';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default async function Onboarding({ searchParams }: { searchParams: { show?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'onboarding')) return <Gate title="Onboarding" feature="New-hire onboarding" />;
  const show = searchParams.show === 'done' ? 'done' : 'active';
  const [obs, packages, eligible] = await Promise.all([
    ctx.tdb.onboarding.findMany({
      where: show === 'done' ? { status: { in: ['COMPLETE', 'CANCELLED'] } } : { status: 'IN_PROGRESS' },
      include: { steps: true, application: { select: { candidate: { select: { name: true } }, job: { select: { title: true, client: { select: { name: true } } } } } } },
      orderBy: [{ startDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: 200,
    }),
    ctx.tdb.onboardingPackage.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ctx.tdb.application.findMany({
      where: { stage: { in: ['OFFER', 'PLACED'] }, onboardings: { none: { status: { not: 'CANCELLED' } } } },
      include: { candidate: { select: { name: true } }, job: { select: { title: true, startDate: true, client: { select: { name: true } } } } }, orderBy: { stageChangedAt: 'desc' }, take: 200,
    }),
  ]);
  const today = ymd(new Date());
  const rows = await Promise.all(obs.map(async (o) => {
    const p = progress(o.steps.map((s) => ({ ...s, config: (s.config ?? {}) as Record<string, unknown> })), await verifiedTypes(ctx.tdb, o.candidateId));
    const i9 = o.steps.find((s) => s.kind === 'STAFF' && (s.config as { task?: string }).task === 'i9');
    const due = o.startDate && i9 && i9.status === 'PENDING' ? i9Due(ymd(o.startDate)) : null;
    return { o, p, due };
  }));
  return (
    <>
      <h1>Onboarding</h1>
      <p className="lede">Send each new hire one link for their paperwork: documents to sign, an emergency contact and uploads. Track what they still owe and your own tasks (I-9, payroll setup, background check) until they’re ready to start.</p>
      <div className="bar">
        <Link className={`btn ${show === 'active' ? '' : 'ghost'} sm`} href="?">In progress</Link>
        <Link className={`btn ${show === 'done' ? '' : 'ghost'} sm`} href="?show=done">Finished & cancelled</Link>
        <span className="grow" />
        <Link className="btn ghost" href="/app/onboarding/packages">Packages ({packages.length})</Link>
      </div>
      {canEdit(ctx) && show === 'active' && (
        <StartOnboarding packages={packages}
          eligible={eligible.map((a) => ({ id: a.id, label: `${a.candidate.name} — ${[a.job.title, a.job.client?.name].filter(Boolean).join(', ')} (${a.stage === 'OFFER' ? 'offer' : 'placed'})`, startDate: a.job.startDate ? ymd(a.job.startDate) : '' }))} />
      )}
      {rows.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>New hire</th><th>Package</th><th>Starts</th><th>Progress</th><th>Next step</th><th>I-9</th></tr></thead>
          <tbody>{rows.map(({ o, p, due }) => (
            <tr key={o.id}>
              <td><Link href={`/app/onboarding/${o.id}`}><b>{o.application.candidate.name}</b></Link><div className="muted">{[o.application.job.title, o.application.job.client?.name].filter(Boolean).join(' · ')}</div></td>
              <td>{o.packageName}{!o.invitedAt && o.status === 'IN_PROGRESS' && <div><span className="pill a">Link not sent</span></div>}</td>
              <td>{o.startDate ? fmt(ymd(o.startDate)) : '—'}</td>
              <td>{o.status === 'CANCELLED' ? <span className="pill r">Cancelled</span> : (
                <span className="quota"><span className="obbar"><span style={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} /></span><small>{p.done}/{p.total}</small></span>
              )}</td>
              <td>{o.status === 'COMPLETE' ? <span className="pill g">Ready to start</span> : o.status === 'CANCELLED' ? '—' : p.next ?? <span className="okc">Only optional steps left</span>}</td>
              <td>{due ? <span className={due < today ? 'warn' : 'soon'}>{due < today ? `Overdue (was due ${fmt(due)})` : `Due ${fmt(due)}`}</span> : <span className="muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty"><b>{show === 'done' ? 'Nothing finished yet' : 'No one onboarding'}</b>{show === 'done' ? 'Finished and cancelled onboardings show here.' : packages.length ? 'Move a candidate to Offer or Placed, then start their onboarding above.' : 'Start by adding a package on the Packages page.'}</div>}
    </>
  );
}
