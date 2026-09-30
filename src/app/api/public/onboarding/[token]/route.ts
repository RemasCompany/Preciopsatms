import { z } from 'zod';
import { hasFeature } from '@/lib/plans';
import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { openSign, saveForm } from '@/lib/onboarding-server';

import { limited } from '@/lib/rate-limit';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sign'), stepId: z.string() }),
  z.object({ action: z.literal('form'), stepId: z.string(), data: z.unknown() }),
]);

/** The new hire opens a document to sign, or saves a form, from their private link. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await limited('onboarding', params.token.slice(0, 20), 40)) return Response.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link) return Response.json({ error: 'This link has expired. Ask your recruiter for a new onboarding link.' }, { status: 404 });
  if (!hasFeature(link.organization, 'onboarding')) return Response.json({ error: 'Onboarding isn’t turned on for this company.' }, { status: 402 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: 'Something went wrong. Try again.' }, { status: 400 });
  try {
    if (b.data.action === 'sign') return Response.json(await openSign(link, b.data.stepId, params.token));
    await saveForm(link, b.data.stepId, b.data.data);
    return Response.json({ ok: true });
  } catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
