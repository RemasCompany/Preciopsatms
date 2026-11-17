import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { aiJson } from '@/lib/ai';
import { redactNotes } from '@/lib/resume';
import { SECTORS } from '@/lib/records';

const TYPES = ['CONTRACT', 'CONTRACT_TO_HIRE', 'DIRECT_HIRE', 'TEMP', 'PER_DIEM', 'FULL_TIME', 'PART_TIME', 'SEASONAL'] as const;
const EMPLOYER_TYPES = ['FULL_TIME', 'PART_TIME', 'SEASONAL', 'TEMP', 'PER_DIEM', 'CONTRACT'] as const;

const Input = z.object({
  brief: z.string().trim().max(4000, 'Keep the notes under 4,000 characters.').default(''),
  title: z.string().trim().max(160).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  type: z.string().max(40).optional().nullable(),
  sector: z.string().max(60).optional().nullable(),
  payRate: z.coerce.number().min(0).optional().nullable(),
  skills: z.array(z.string().max(60)).max(40).optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
});

type Draft = { title?: unknown; sector?: unknown; type?: unknown; openings?: unknown; payRate?: unknown; skills?: unknown; description?: unknown };
export type JobDraft = { title: string; sector: string | null; type: string | null; openings: number | null; payRate: number | null; skills: string[]; description: string };

/**
 * Write a job post from a short brief (and whatever is already filled in). Emails, phone numbers, links and street
 * addresses typed into the brief are masked before it reaches the model. Pay is only filled in when the brief states it.
 */
export const POST = withApi(async (req: Request) => {
  const { org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ai' });
  const input = Input.parse(await req.json());
  const brief = input.brief ? redactNotes(input.brief, null) : '';
  if (brief.length < 10 && !input.title?.trim()) throw new HttpError(400, 'Describe the job in a sentence or two, or fill in the job title first.');

  const employer = org.kind === 'EMPLOYER';
  const types = employer ? EMPLOYER_TYPES : TYPES;
  const firm = org.shortName ?? org.name;
  const known = {
    title: input.title || undefined, location: input.location || undefined, employmentType: input.type || undefined, sector: input.sector || undefined,
    payRatePerHour: input.payRate ?? undefined, skills: input.skills?.length ? input.skills : undefined,
    currentDescription: input.description?.trim() ? redactNotes(input.description.slice(0, 6000), null) : undefined,
  };
  const res = await aiJson<Draft>(org,
    `You write job posts for ${firm}, ${employer ? 'an employer hiring for its own team' : 'a staffing agency hiring workers for its clients'}${org.city ? ` based in ${org.city}` : ''}${org.services ? `, serving ${org.services}` : ''}.
Write an engaging, accurate, inclusive job post that candidates want to read and that job boards accept.
Rules:
- Use only facts from the brief and the details below. Never invent pay, benefits, schedules, company names, certifications or requirements that weren't given. Where a fact is missing, leave it out.
- Contact details have been replaced with [email], [phone], [link] or [address]; leave those out of the post.
- No discriminatory or age-, gender- or nationality-coded wording.
- If the brief states an hourly pay rate, return it as payRate (number). Otherwise payRate is null.
- The description is plain text, no markdown, no asterisks or # signs. Short sections, each starting with its heading on its own line: About the role, What you'll do, What you bring, ${employer ? 'Why join us' : 'Why work with us'}. Use "- " for list lines. 150 to 350 words. End with one line inviting people to apply.
- If there is a current description, improve it instead of starting over.
BRIEF: ${brief || '(none)'}
DETAILS ALREADY ENTERED: ${JSON.stringify(known)}
Return JSON: {"title":"clear, searchable job title","sector":one of ${JSON.stringify(SECTORS)},"type":one of ${JSON.stringify(types)},"openings":number or null,"payRate":number or null,"skills":["up to 10 short skills"],"description":"..."}`, 2000);

  const description = String(res.description ?? '').replace(/\*\*|__|^#+\s*/gm, '').trim();
  if (description.length < 40) throw new HttpError(502, 'The AI reply could not be read. Try again.');
  const pick = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : null);
  const openings = Math.round(Number(res.openings));
  const pay = Number(res.payRate);
  const draft: JobDraft = {
    title: String(res.title ?? '').trim().slice(0, 160) || input.title || '',
    sector: pick(res.sector, SECTORS),
    type: pick(res.type, types),
    openings: Number.isFinite(openings) && openings >= 1 && openings <= 999 ? openings : null,
    // Pay is only kept when the brief itself mentions a number, so the model can't make one up.
    payRate: Number.isFinite(pay) && pay > 0 && /\d/.test(brief) ? Math.round(pay * 100) / 100 : null,
    skills: Array.isArray(res.skills) ? [...new Set(res.skills.map((s) => String(s).trim().slice(0, 60)).filter(Boolean))].slice(0, 10) : [],
    description: description.slice(0, 20000),
  };
  return Response.json({ draft });
});
