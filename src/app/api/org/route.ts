import { z } from 'zod';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { db } from '@/lib/db';
import { audit, diff } from '@/lib/audit';

const text = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable().optional();
const url = z.string().trim().max(300).refine((s) => !s || /^https:\/\/\S+\.\S+/.test(s), 'Use a full https:// address.').transform((s) => s || null).nullable().optional();

/** Company profile (white-label) and careers-page settings. The slug is fixed: careers links, embeds and feeds depend on it. */
const Settings = z.object({
  name: z.string().trim().min(2, 'Enter your legal company name.').max(160).optional(),
  shortName: text(80), ownerName: text(120), ownerTitle: text(120), city: text(120), website: url, services: text(300), pitch: text(300), logoUrl: url,
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i, 'Pick a button color.').optional(),
  applyEmail: z.string().trim().max(200).refine((s) => !s || z.string().email().safeParse(s).success, 'Enter a valid apply-by-email address.').transform((s) => s || null).nullable().optional(),
  careersHeadline: z.string().trim().min(2, 'Add a headline for your careers page.').max(120).optional(),
  careersIntro: text(2000), showPayOnCareers: z.boolean().optional(), showClientOnCareers: z.boolean().optional(),
  // Indeed Apply credentials from Indeed's partner console. The secret is write-only (never sent back to the browser).
  indeedApplyApiToken: z.string().trim().max(200).regex(/^[\w-]*$/, 'That doesn’t look like an Indeed Apply API token.').transform((s) => s || null).nullable().optional(),
  indeedApplySecret: z.string().trim().max(500).transform((s) => s || null).nullable().optional(),
}).strict();

export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const parsed = Settings.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.code === 'unrecognized_keys' ? 'That setting can’t be changed here.' : parsed.error.issues[0]?.message ?? 'Invalid input');
  const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  await db.organization.update({ where: { id: org.id }, data });
  await logActivity(org.id, 'Updated company settings', user.id);
  const changes = diff(org as unknown as Record<string, unknown>, data);
  await audit(org.id, user, 'settings.company', `Changed company settings: ${Object.keys(changes).join(', ') || 'no changes'}`, { changes, req });
  return Response.json({ ok: true });
});
