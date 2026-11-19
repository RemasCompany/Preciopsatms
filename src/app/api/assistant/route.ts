import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { limited } from '@/lib/rate-limit';
import { ask } from '@/lib/assistant';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // HR answers may search official sites

const Body = z.object({
  question: z.string().trim().min(2, 'Type a question.').max(1000, 'Keep questions under 1,000 characters.'),
  history: z.array(z.object({ q: z.string().max(1000), a: z.string().max(12000) })).max(10).default([]),
  mode: z.enum(['business', 'coach', 'hr']).default('business'),
});

/** Ask the assistant about this company's data, for manager coaching, or an HR compliance question. One AI credit per question. */
export const POST = withApi(async (req: Request) => {
  const { org, role, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ai', write: true });
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Type a question.' }, { status: 400 });
  if (await limited('assistant', user.id, 20, 60e3)) return Response.json({ error: 'That’s a lot of questions at once. Wait a minute and try again.' }, { status: 429 });
  return Response.json(await ask(org, role, b.data.question, b.data.history, b.data.mode));
});
