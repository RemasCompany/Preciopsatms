import { z } from 'zod';
import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { limited } from '@/lib/rate-limit';
import { sendPortalLink } from '@/lib/portal-server';

const Body = z.object({ slug: z.string().trim().max(80), email: z.string().trim().toLowerCase().email('Enter your work email.') });
const DONE = 'If that email belongs to a client contact, we’ve sent a sign-in link. Check your inbox.';

/** Public: a client contact asks for a new portal link. Same answer whether or not the email is known. */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0].message }, { status: 400 });
  if (await limited('portal-login-ip', ip, 10, 3600e3) || await limited('portal-login', `${b.data.slug}:${b.data.email}`, 3, 3600e3)) return Response.json({ error: 'Too many requests. Try again in an hour.' }, { status: 429 });
  const org = await db.organization.findUnique({ where: { slug: b.data.slug } });
  if (org && hasFeature(org, 'clientPortal')) {
    const c = await tenantDb(org.id).contact.findFirst({ where: { email: { equals: b.data.email, mode: 'insensitive' } } });
    // Only contacts who were given portal access before can request a new link.
    if (c && (await tenantDb(org.id).clientPortalLink.count({ where: { contactId: c.id, revokedAt: null } }))) await sendPortalLink(org, c.id, null).catch((e) => console.error('[portal] login link failed', e));
  }
  return Response.json({ ok: true, message: DONE });
}
