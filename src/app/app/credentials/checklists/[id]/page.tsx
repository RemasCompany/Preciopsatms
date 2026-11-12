import { notFound } from 'next/navigation';
import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { RATINGS, SKILLS_CHECKLISTS, summarize } from '@/lib/skills-checklists';
import Gate from '@/components/Gate';
import PrintButton from '@/components/PrintButton';

const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** A completed checklist, laid out to print or save as PDF for a facility submittal. */
export default async function ChecklistPrint({ params }: { params: { id: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'credentials')) return <Gate title="Skills checklist" feature="Credential tracking" />;
  const r = await ctx.tdb.skillsChecklist.findFirst({ where: { id: params.id, status: 'COMPLETED' }, include: { candidate: { select: { name: true } } } });
  if (!r || !SKILLS_CHECKLISTS[r.specialty]) notFound();
  const s = summarize(r.specialty, (r.answers ?? {}) as Record<string, number>);
  const label = (v: number | null) => RATINGS.find((x) => x.value === v)?.label ?? '—';
  return (
    <div className="printable">
      <div className="row noprint" style={{ justifyContent: 'flex-end' }}><PrintButton /></div>
      <p className="muted" style={{ margin: 0 }}>{ctx.org.name}</p>
      <h1 style={{ marginTop: 4 }}>{SKILLS_CHECKLISTS[r.specialty].title} skills checklist</h1>
      <p><b>{r.candidate.name}</b> · completed {fmt(r.completedAt!)} · signed “{r.signedName}” · average {s.average ?? '—'} of 4</p>
      <p className="muted">Self-assessment. {RATINGS.map((x) => `${x.value} = ${x.label}`).join('; ')}.</p>
      {s.sections.map((sec) => (
        <section key={sec.title} style={{ breakInside: 'avoid' }}>
          <h2 style={{ fontSize: 16, margin: '16px 0 4px' }}>{sec.title}{sec.average !== null && <span className="muted" style={{ fontWeight: 400 }}> · average {sec.average}</span>}</h2>
          <table><tbody>{sec.items.map((x) => <tr key={x.item}><td>{x.item}</td><td style={{ width: 40, textAlign: 'center' }}><b>{x.rating ?? '—'}</b></td><td className="muted" style={{ width: 220 }}>{label(x.rating)}</td></tr>)}</tbody></table>
        </section>
      ))}
      {s.needsSupport.length > 0 && <p><b>Plan orientation for:</b> {s.needsSupport.join('; ')}.</p>}
      <p className="muted">I attest that these answers are an accurate picture of my experience. — {r.signedName}, {fmt(r.completedAt!)}</p>
    </div>
  );
}
