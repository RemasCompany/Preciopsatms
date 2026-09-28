import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { DOC_TYPES, type DocType } from '@/lib/esign';
import Documents from '@/components/Documents';
import Gate from '@/components/Gate';

export default async function DocumentsPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'esign')) return <Gate title="E-signatures" feature="E-signatures" />;
  const { tdb } = ctx;
  const docs = await tdb.signDocument.findMany({ orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, type: true, relatedType: true, relatedId: true, status: true, createdAt: true, signedAt: true, counterSignedAt: true } });
  const ids = (t: string) => docs.filter((d) => d.relatedType === t).map((d) => d.relatedId);
  const [cands, vendors, clients] = await Promise.all([
    tdb.candidate.findMany({ where: { id: { in: ids('candidate') } }, select: { id: true, name: true } }),
    tdb.vendor.findMany({ where: { id: { in: ids('vendor') } }, select: { id: true, name: true } }),
    tdb.client.findMany({ where: { id: { in: ids('client') } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...cands, ...vendors, ...clients].map((r) => [r.id, r.name]));
  const rows = docs.map((d) => ({
    id: d.id, title: d.title, typeLabel: DOC_TYPES[d.type as DocType] ?? 'Document', forName: names.get(d.relatedId) ?? 'Deleted record', status: d.status,
    created: d.createdAt.toISOString(), signed: d.signedAt?.toISOString() ?? null, countersigned: !!d.counterSignedAt,
  }));
  const admin = ctx.role === 'OWNER' || ctx.role === 'ADMIN';
  return (
    <>
      <h1>E-signatures</h1>
      <p className="lede">Offer letters, assignment confirmations, vendor and client agreements — generated from your records, sent for signature, locked, fingerprinted and saved as PDF with an audit trail.</p>
      <Documents rows={rows} canEdit={canEdit(ctx)} admin={admin && canEdit(ctx)} />
      <p className="muted" style={{ marginTop: 14 }}>The templates are starting points; have your attorney review the language before you rely on it.</p>
    </>
  );
}
