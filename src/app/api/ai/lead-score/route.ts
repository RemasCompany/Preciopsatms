import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { aiJson } from '@/lib/ai';

export type LeadScore = { score: number; why: string; nextStep: string; subject: string; body: string };

/** Score a lead's fit and draft a first-touch email. The contact's name and details are not sent to the model. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ai' });
  if (!hasFeature(org, 'leads')) throw new HttpError(402, 'This feature is not included in your plan');
  const { leadId } = z.object({ leadId: z.string() }).parse(await req.json());
  const lead = await tdb.lead.findFirst({ where: { id: leadId } });
  if (!lead) throw new HttpError(404, 'That lead was deleted.');
  const firm = org.shortName ?? org.name;
  const res = await aiJson<LeadScore>(org,
    `You qualify B2B leads for ${firm}, a staffing firm${org.city ? ` based in ${org.city}` : ''}${org.services ? ` serving ${org.services}` : ''}.${org.pitch ? ` ${org.pitch}` : ''}
Score this lead's fit 0-100 and draft a short first-touch email from ${org.ownerName ?? 'the owner'}${org.ownerTitle ? `, ${org.ownerTitle}` : ''}. Start the email with "Hi [First name]," exactly — the app fills in the name.
LEAD: ${JSON.stringify({ company: lead.company, contactTitle: lead.role, industry: lead.industry, size: lead.size, city: lead.city, source: lead.source, notes: lead.notes?.slice(0, 1500) })}
Return JSON: {"score":number,"why":"one sentence","nextStep":"one concrete action","subject":"...","body":"under 130 words, plain text, personal, one clear ask"}`, 900);
  const score = Math.max(0, Math.min(100, Math.round(Number(res.score))));
  if (!Number.isFinite(score) || typeof res.body !== 'string') throw new HttpError(502, 'The AI reply could not be read. Try again.');
  return Response.json({ score, why: String(res.why ?? ''), nextStep: String(res.nextStep ?? ''), subject: String(res.subject ?? ''), body: res.body });
});
