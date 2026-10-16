import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { aiJson } from '@/lib/ai';
import { redactNotes } from '@/lib/resume';

export type LeadScore = { score: number; why: string; nextStep: string; subject: string; body: string };

/**
 * Score a lead's fit and draft a first-touch email. No names or contact details reach the model: the contact's name,
 * emails, phone numbers, links and street addresses are masked in the notes, and the sender signs as a placeholder that
 * is filled in here.
 */
export const POST = withApi(async (req: Request) => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ai' });
  if (!hasFeature(org, 'leads')) throw new HttpError(402, 'This feature is not included in your plan');
  const { leadId } = z.object({ leadId: z.string() }).parse(await req.json());
  const lead = await tdb.lead.findFirst({ where: { id: leadId } });
  if (!lead) throw new HttpError(404, 'That lead was deleted.');
  const firm = org.shortName ?? org.name;
  const notes = lead.notes ? redactNotes(lead.notes.slice(0, 3000), lead.contact?.trim() || null).slice(0, 1500) : null;
  const res = await aiJson<LeadScore>(org,
    `You qualify B2B leads for ${firm}, a staffing firm${org.city ? ` based in ${org.city}` : ''}${org.services ? ` serving ${org.services}` : ''}.${org.pitch ? ` ${org.pitch}` : ''}
Score this lead's fit 0-100 and draft a short first-touch email from [Your name]${org.ownerTitle ? `, ${org.ownerTitle}` : ''}. Names and contact details are hidden. Start the email with "Hi [First name]," exactly, sign it "[Your name]", keep any placeholder in square brackets exactly as written, and never write a name for anyone.
LEAD: ${JSON.stringify({ company: lead.company, contactTitle: lead.role, industry: lead.industry, size: lead.size, city: lead.city, source: lead.source, notes })}
Return JSON: {"score":number,"why":"one sentence","nextStep":"one concrete action","subject":"...","body":"under 130 words, plain text, personal, one clear ask"}`, 900);
  const score = Math.max(0, Math.min(100, Math.round(Number(res.score))));
  if (!Number.isFinite(score) || typeof res.body !== 'string') throw new HttpError(502, 'The AI reply could not be read. Try again.');
  // Put the names back: the contact's first name is filled in on the page; the sender's here.
  const sender = org.ownerName?.trim() || firm;
  const back = (t: unknown) => String(t ?? '').replace(/\[Your name\]/gi, sender).replace(/\[name\]/gi, '[First name]');
  return Response.json({ score, why: back(res.why), nextStep: back(res.nextStep), subject: back(res.subject), body: back(res.body) });
});
