import { requireApiContext, withApi } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';

export const dynamic = 'force-dynamic';

/** People to write to, found by name, email, phone or company: candidates and workers, client contacts, leads and vendors. */
export const GET = withApi(async (req: Request) => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging' });
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 80);
  if (q.length < 2) return Response.json({ people: [] });
  const has = { contains: q, mode: 'insensitive' as const };
  const digits = q.replace(/\D/g, '');
  const contactable = { OR: [{ email: { not: null } }, { phone: { not: null } }] };
  const [cands, contacts, leads, vendors] = await Promise.all([
    tdb.candidate.findMany({ where: { AND: [contactable, { OR: [{ name: has }, { email: has }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] }] }, take: 8, orderBy: { updatedAt: 'desc' } }),
    hasFeature(org, 'crm') ? tdb.contact.findMany({ where: { AND: [contactable, { OR: [{ name: has }, { email: has }, { client: { name: has } }] }] }, include: { client: { select: { name: true } } }, take: 6 }) : [],
    hasFeature(org, 'leads') ? tdb.lead.findMany({ where: { AND: [contactable, { OR: [{ contact: has }, { company: has }, { email: has }] }] }, take: 6 }) : [],
    hasFeature(org, 'vendors') ? tdb.vendor.findMany({ where: { AND: [contactable, { OR: [{ name: has }, { contact: has }, { email: has }] }] }, take: 4 }) : [],
  ]);
  return Response.json({ people: [
    ...cands.map((c) => ({ type: 'candidate', id: c.id, name: c.name, sub: c.status, email: c.email, phone: c.phone, emailOptOut: c.emailOptOut, smsOptOut: c.smsOptOut })),
    ...contacts.map((c) => ({ type: 'contact', id: c.id, name: c.name, sub: c.client.name, email: c.email, phone: c.phone, emailOptOut: c.emailOptOut, smsOptOut: c.smsOptOut })),
    ...leads.map((l) => ({ type: 'lead', id: l.id, name: l.contact || l.company, sub: `Lead · ${l.company}`, email: l.email, phone: l.phone, emailOptOut: l.emailOptOut, smsOptOut: l.smsOptOut })),
    ...vendors.map((v) => ({ type: 'vendor', id: v.id, name: v.contact || v.name, sub: `Vendor · ${v.name}`, email: v.email, phone: v.phone, emailOptOut: false, smsOptOut: false })),
  ] });
});
