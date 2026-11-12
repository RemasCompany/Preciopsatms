import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, tenantDb, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { newToken, sha256 } from './tokens';
import { limited } from './rate-limit';
import { audit } from './audit';

/**
 * The Preciops API (Enterprise): companies connect their own systems with a secret key, sent as
 * "Authorization: Bearer pk_…". Only a hash of the key is stored; the key is shown once when it's made. Every request is
 * scoped to the key's company through tenantDb. EEO self-identification is never part of the API.
 */
export const KEY_PREFIX = 'pk_live_';
export const RATE_PER_MINUTE = 120;
export const NameBody = z.object({ name: z.string().trim().min(2, 'Name the key after what uses it (e.g. “Data warehouse”).').max(60, 'Keep the name under 60 characters.') });

export async function createKey(org: Organization, user: User, raw: unknown) {
  const p = NameBody.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const tdb = tenantDb(org.id);
  if (await tdb.apiKey.count({ where: { revokedAt: null } }) >= 20) throw new HttpError(400, 'You have 20 keys. Revoke one you no longer use first.');
  const key = `${KEY_PREFIX}${newToken()}`;
  const row = await tdb.apiKey.create({ data: { name: p.data.name, prefix: key.slice(0, 14), keyHash: sha256(key), createdById: user.id } as never });
  await audit(org.id, user, 'settings.api_key', `Created API key “${p.data.name}”`, { targetType: 'ApiKey', targetId: row.id });
  return { id: row.id, key };
}

export async function revokeKey(org: Organization, user: User, id: string) {
  const tdb = tenantDb(org.id);
  const k = await tdb.apiKey.findFirst({ where: { id, revokedAt: null } });
  if (!k) throw new HttpError(404, 'That key was already revoked.');
  await tdb.apiKey.updateMany({ where: { id }, data: { revokedAt: new Date() } });
  await audit(org.id, user, 'settings.api_key', `Revoked API key “${k.name}”`, { targetType: 'ApiKey', targetId: id });
}

export async function listKeys(tdb: TenantDb) {
  const rows = await tdb.apiKey.findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'desc' } });
  return rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, created: k.createdAt.toISOString().slice(0, 10), lastUsed: k.lastUsedAt?.toISOString() ?? null }));
}

type ApiCtx = { org: Organization; tdb: TenantDb; keyId: string };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/** Wraps an API route: checks the key, the plan and the rate limit, and turns errors into JSON. */
export function apiRoute(handler: (req: Request, ctx: ApiCtx, params: Record<string, string>) => Promise<Response>) {
  return async (req: Request, { params }: { params?: Record<string, string> } = {}) => {
    const m = /^Bearer\s+(pk_live_[\w-]{20,100})$/.exec(req.headers.get('authorization') ?? '');
    if (!m) return fail(401, 'Send your API key as “Authorization: Bearer pk_live_…”. Create one in Settings → API keys.');
    const k = await db.apiKey.findUnique({ where: { keyHash: sha256(m[1]) }, include: { organization: true } });
    if (!k || k.revokedAt) return fail(401, 'That API key isn’t valid. It may have been revoked.');
    const org = k.organization;
    if (!['trialing', 'active'].includes(org.subscriptionStatus)) return fail(402, 'The subscription for this company isn’t active.');
    if (!hasFeature(org, 'api')) return fail(403, 'The API is part of the Enterprise plan.');
    if (await limited('api', k.id, RATE_PER_MINUTE, 60e3)) return fail(429, `Too many requests. The limit is ${RATE_PER_MINUTE} a minute per key.`);
    const tdb = tenantDb(org.id);
    if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60e3) await tdb.apiKey.updateMany({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
    try { return await handler(req, { org, tdb, keyId: k.id }, params ?? {}); }
    catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      if (e instanceof z.ZodError) return fail(400, e.issues[0]?.message ?? 'Invalid input');
      throw e;
    }
  };
}

/** ?limit= (1–200, default 50) and ?cursor= (the last id of the previous page). */
export function page(req: Request) {
  const u = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit')) || 50));
  const cursor = u.searchParams.get('cursor');
  return { limit, after: cursor ? { id: { gt: cursor } } : {}, args: { take: limit + 1, orderBy: { id: 'asc' as const } }, u };
}
export function paged<T extends { id: string }>(rows: T[], limit: number) {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  return { data, nextCursor: more ? data[data.length - 1].id : null };
}
