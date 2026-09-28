import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';

/** Convert a lead into a prospect client (with its contact) and a qualified deal. */
export const POST = withApi(async (_req: Request, { params }: { params: { kind: string; id: string } }) => {
  if (params.kind !== 'leads') throw new HttpError(404, 'Not found');
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'crm', write: true });
  const lead = await tdb.lead.findFirst({ where: { id: params.id } });
  if (!lead) throw new HttpError(404, 'That lead was deleted.');
  if (lead.status === 'Converted') throw new HttpError(409, 'This lead is already converted.');
  const client = await tdb.client.create({ data: { name: lead.company, industry: lead.industry, city: lead.city, status: 'Prospect', notes: lead.notes } as never });
  if (lead.contact) await tdb.contact.create({ data: { clientId: client.id, name: lead.contact, title: lead.role, email: lead.email, phone: lead.phone } as never });
  const deal = await tdb.deal.create({ data: { clientId: client.id, title: `${lead.company} — staffing`, stage: 'Qualified' } as never });
  await tdb.lead.updateMany({ where: { id: lead.id }, data: { status: 'Converted' } });
  await logActivity(org.id, `Converted lead ${lead.company} into a client and deal`, user.id);
  return Response.json({ clientId: client.id, dealId: deal.id });
});
