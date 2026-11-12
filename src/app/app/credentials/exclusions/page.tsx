import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { AUTO_TYPE, OIG_SEARCH_URL, VALID_DAYS, listDate } from '@/lib/exclusions';
import Gate from '@/components/Gate';
import CredentialTabs from '@/components/CredentialTabs';
import Exclusions from '@/components/Exclusions';

export default async function ExclusionsPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'credentials')) return <Gate title="Credentials" feature="Credential tracking" />;
  const admin = (ctx.role === 'OWNER' || ctx.role === 'ADMIN') && canEdit(ctx);
  const [matches, screened] = await Promise.all([
    ctx.tdb.exclusionMatch.findMany({ include: { candidate: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }], take: 300 }),
    ctx.tdb.credential.count({ where: { type: AUTO_TYPE, verifiedAt: { not: null }, expiresAt: { gte: new Date() } } }),
  ]);
  const reviewers = new Map((await ctx.tdb.auditLog.findMany({ where: { action: 'exclusion.review' }, select: { actorId: true, actorEmail: true }, take: 500 })).map((a) => [a.actorId, a.actorEmail]));
  const rows = matches.map((m) => ({
    id: m.id, candidateId: m.candidate.id, worker: m.candidate.name, listedName: m.listedName, listedPlace: m.listedPlace, listedNpi: m.listedNpi,
    dob: listDate(m.listedDob), excluded: listDate(m.exclDate), exclType: m.exclType, specialty: m.specialty, matchedOn: m.matchedOn as 'npi' | 'name',
    status: m.status as 'OPEN' | 'CLEARED' | 'CONFIRMED', note: m.reviewNote, reviewedAt: m.reviewedAt?.toISOString() ?? null, reviewedBy: m.reviewedById ? reviewers.get(m.reviewedById) ?? null : null,
  }));
  return (
    <>
      <h1>Credentials</h1>
      <CredentialTabs at="/app/credentials/exclusions" />
      <p className="lede">Every month, everyone on assignment and every current employee is checked against the federal OIG List of Excluded Individuals/Entities. Health care clients that bill Medicare or Medicaid can’t use excluded people. A clean check is saved as a verified “{AUTO_TYPE}” credential, good for {VALID_DAYS} days, so you can require it on jobs. A name match is only a possible match: confirm it on <a href={OIG_SEARCH_URL} target="_blank" rel="noreferrer">OIG’s online search</a>, which checks the Social Security number, then mark it cleared or confirmed here.</p>
      <Exclusions enabled={ctx.org.exclusionScreening} lastRun={ctx.org.exclusionScreenedAt?.toISOString() ?? null} listDate={ctx.org.exclusionListDate} screened={screened} rows={rows} canEdit={admin} />
    </>
  );
}
