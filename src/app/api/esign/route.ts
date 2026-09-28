import { z } from 'zod';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { merge, orgContext } from '@/lib/merge';
import { TEMPLATES } from '@/lib/doc-templates';

const Body = z.object({
  type: z.enum(['offer', 'assignment', 'vendor', 'client', 'custom']),
  relatedType: z.enum(['candidate', 'vendor', 'client']),
  relatedId: z.string(),
  jobId: z.string().optional(),
  title: z.string().max(200).optional(),
  body: z.string().max(50000).optional(),
  signerName: z.string().max(120).optional(),
  signerEmail: z.string().email().optional(),
});

/** Create a draft from a template (merged with record data) or custom text. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'esign', write: true });
  const b = Body.parse(await req.json());
  let name = '', email = '', extra: Record<string, string | undefined> = {};
  if (b.relatedType === 'candidate') {
    const c = await tdb.candidate.findFirst({ where: { id: b.relatedId } }); if (!c) throw new HttpError(404, 'Candidate not found');
    name = c.name; email = c.email ?? '';
    const job = b.jobId ? await tdb.job.findFirst({ where: { id: b.jobId }, include: { client: true } }) : null;
    extra = { job_title: job?.title, client: job?.client?.name, job_location: job?.location ?? undefined, start_date: job?.startDate?.toLocaleDateString('en-US', { dateStyle: 'long' }), pay_rate: job?.payRate ? `$${job.payRate} per hour` : undefined, job_type: job?.type.toLowerCase().replace(/_/g, '-') };
  } else if (b.relatedType === 'vendor') {
    const v = await tdb.vendor.findFirst({ where: { id: b.relatedId } }); if (!v) throw new HttpError(404, 'Vendor not found');
    name = v.name; email = v.email ?? ''; extra = { fee: v.feePct ? `${v.feePct}%` : undefined };
  } else {
    const c = await tdb.client.findFirst({ where: { id: b.relatedId }, include: { contacts: { take: 1 } } }); if (!c) throw new HttpError(404, 'Client not found');
    name = c.name; email = c.contacts[0]?.email ?? ''; extra = { markup: c.markupPct ? `${c.markupPct}%` : undefined, terms: c.paymentTerms };
  }
  const tpl = b.type === 'custom' ? null : TEMPLATES[b.type];
  const ctx = { ...orgContext(org), ...extra, name, date: new Date().toLocaleDateString('en-US', { dateStyle: 'long' }) };
  const doc = await tdb.signDocument.create({
    data: {
      type: b.type, relatedType: b.relatedType, relatedId: b.relatedId,
      title: b.title ?? `${tpl?.name ?? 'Document'} — ${name}`,
      body: b.body ?? merge(tpl?.body ?? '', ctx),
      signerName: b.signerName ?? name, signerEmail: b.signerEmail ?? email,
      audit: [{ at: new Date().toISOString(), event: 'created', by: user.email }],
    } as never,
  });
  await logActivity(org.id, `Created ${doc.title}`, user.id);
  return Response.json({ document: doc }, { status: 201 });
});
