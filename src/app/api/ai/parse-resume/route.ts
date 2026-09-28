import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { aiJson } from '@/lib/ai';

export const POST = withApi(async (req: Request) => {
  const { org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ai' });
  const { text } = z.object({ text: z.string().min(40).max(40000) }).parse(await req.json());
  const profile = await aiJson<Record<string, unknown>>(org,
    `Extract a candidate profile from this resume for a staffing agency ATS. Keys: name, title, email, phone, location, sector, yearsExp (number), skills (array, max 15), certs (array), summary (2-3 sentences). Use "" or [] when unknown. Do not include age, date of birth, photo descriptions, marital status or other protected characteristics.
RESUME:
${text}`);
  return Response.json({ profile });
});
