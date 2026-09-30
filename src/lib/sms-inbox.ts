import { z } from 'zod';
import type { User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { sendSms, toE164 } from './sms';

/**
 * Two-way texting. Every company can share one Twilio number, so a reply is routed to: the company whose own number
 * it was sent to (Organization.smsNumber), else the company that last texted that phone, else the only company that
 * knows the phone. Within the company it's matched to a candidate, then a client contact, then a lead.
 */
export const OPT_OUT = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
export const OPT_IN = ['START', 'UNSTOP'];
const last10 = (p: string) => p.replace(/\D/g, '').slice(-10);
export type PartyType = 'candidate' | 'contact' | 'lead';
type Party = { type: PartyType; id: string; name: string; phone: string | null; smsOptOut: boolean };

/** Everyone in a company with this phone number, candidates first. */
async function partiesByPhone(tdb: TenantDb, phone: string): Promise<Party[]> {
  const d = last10(phone), hint = { contains: d.slice(-4) };
  const [c, k, l] = await Promise.all([
    tdb.candidate.findMany({ where: { phone: hint }, select: { id: true, name: true, phone: true, smsOptOut: true } }),
    tdb.contact.findMany({ where: { phone: hint }, select: { id: true, name: true, phone: true, smsOptOut: true } }),
    tdb.lead.findMany({ where: { phone: hint }, select: { id: true, contact: true, company: true, phone: true, smsOptOut: true } }),
  ]);
  const same = (p: string | null) => !!p && last10(p) === d;
  return [
    ...c.filter((x) => same(x.phone)).map((x) => ({ type: 'candidate' as const, ...x })),
    ...k.filter((x) => same(x.phone)).map((x) => ({ type: 'contact' as const, ...x })),
    ...l.filter((x) => same(x.phone)).map((x) => ({ type: 'lead' as const, id: x.id, name: x.contact || x.company, phone: x.phone, smsOptOut: x.smsOptOut })),
  ];
}

/** Which company a reply belongs to. */
export async function routeInbound(from: string, to: string | null) {
  if (to) {
    const own = await db.organization.findFirst({ where: { smsNumber: toE164(to) ?? to }, select: { id: true } });
    if (own) return own.id;
  }
  const d = last10(from);
  const recent = await db.message.findMany({ where: { channel: 'sms', direction: 'out', toAddress: { contains: d.slice(-4) }, createdAt: { gte: new Date(Date.now() - 60 * 864e5) } }, orderBy: { createdAt: 'desc' }, take: 50, select: { organizationId: true, toAddress: true } });
  const hit = recent.find((m) => last10(m.toAddress) === d);
  if (hit) return hit.organizationId;
  const orgs = new Set<string>();
  for (const [model, field] of [['candidate', 'phone'], ['contact', 'phone'], ['lead', 'phone']] as const) {
    const rows = await (db[model] as unknown as { findMany: (a: object) => Promise<{ organizationId: string; phone: string | null }[]> }).findMany({ where: { [field]: { contains: d.slice(-4) } }, select: { organizationId: true, phone: true } });
    rows.filter((r) => r.phone && last10(r.phone) === d).forEach((r) => orgs.add(r.organizationId));
  }
  return orgs.size === 1 ? [...orgs][0] : null;
}

/** Stores an inbound text and applies STOP/START. Opt-outs apply in every company that has the number (carrier rules). */
export async function receive(p: { from: string; to: string | null; body: string; sid?: string }) {
  const from = toE164(p.from);
  if (!from) return { stored: false };
  const word = p.body.trim().toUpperCase();
  if (OPT_OUT.includes(word) || OPT_IN.includes(word)) {
    const optOut = OPT_OUT.includes(word), d = last10(from);
    for (const model of ['candidate', 'contact', 'lead'] as const) {
      const m = db[model] as unknown as { findMany: (a: object) => Promise<{ id: string; phone: string | null }[]>; updateMany: (a: object) => Promise<unknown> };
      const ids = (await m.findMany({ where: { phone: { contains: d.slice(-4) } }, select: { id: true, phone: true } })).filter((r) => r.phone && last10(r.phone) === d).map((r) => r.id);
      if (ids.length) await m.updateMany({ where: { id: { in: ids } }, data: { smsOptOut: optOut } });
    }
  }
  const orgId = await routeInbound(from, p.to);
  if (!orgId) return { stored: false };
  const tdb = tenantDb(orgId);
  const parties = await partiesByPhone(tdb, from);
  // Two people can share a phone (family members): the reply is most likely from whoever we texted last.
  let party = parties[0] ?? null;
  if (parties.length > 1) {
    const last = await tdb.message.findFirst({ where: { channel: 'sms', direction: 'out', OR: parties.map((x) => ({ relatedType: x.type, relatedId: x.id })) }, orderBy: { createdAt: 'desc' }, select: { relatedType: true, relatedId: true } });
    party = parties.find((x) => x.type === last?.relatedType && x.id === last?.relatedId) ?? party;
  }
  await tdb.message.create({ data: { channel: 'sms', direction: 'in', toAddress: p.to ?? '', fromAddress: from, body: p.body.slice(0, 1600), status: 'received', providerId: p.sid ?? null, relatedType: party?.type ?? null, relatedId: party?.id ?? null } as never });
  await logActivity(orgId, `Text from ${party?.name ?? from}: “${p.body.slice(0, 140)}”`);
  return { stored: true, orgId, party: party?.name ?? null };
}

export type Thread = { key: string; type: PartyType | null; id: string | null; name: string; phone: string; last: string; lastAt: string; lastIn: boolean; unread: number; optedOut: boolean };

/** Conversations from the last 90 days, most recent first. */
export async function threads(tdb: TenantDb): Promise<Thread[]> {
  const msgs = await tdb.message.findMany({ where: { channel: 'sms', createdAt: { gte: new Date(Date.now() - 90 * 864e5) }, status: { in: ['sent', 'received'] } }, orderBy: { createdAt: 'desc' }, take: 2000,
    select: { direction: true, toAddress: true, fromAddress: true, body: true, createdAt: true, readAt: true, relatedType: true, relatedId: true } });
  const out = new Map<string, Thread>();
  for (const m of msgs) {
    const phone = (m.direction === 'in' ? m.fromAddress : m.toAddress) ?? '';
    const key = m.relatedType && m.relatedId ? `${m.relatedType}:${m.relatedId}` : `phone:${last10(phone)}`;
    const t = out.get(key) ?? { key, type: (m.relatedType as PartyType) ?? null, id: m.relatedId, name: phone, phone, last: m.body, lastAt: m.createdAt.toISOString(), lastIn: m.direction === 'in', unread: 0, optedOut: false };
    if (m.direction === 'in' && !m.readAt) t.unread++;
    out.set(key, t);
  }
  // Names and opt-outs for the people behind each thread.
  const list = [...out.values()];
  const ids = (t: PartyType) => list.filter((x) => x.type === t && x.id).map((x) => x.id!);
  const [c, k, l] = await Promise.all([
    tdb.candidate.findMany({ where: { id: { in: ids('candidate') } }, select: { id: true, name: true, smsOptOut: true } }),
    tdb.contact.findMany({ where: { id: { in: ids('contact') } }, select: { id: true, name: true, smsOptOut: true, client: { select: { name: true } } } }),
    tdb.lead.findMany({ where: { id: { in: ids('lead') } }, select: { id: true, contact: true, company: true, smsOptOut: true } }),
  ]);
  for (const t of list) {
    if (t.type === 'candidate') { const p = c.find((x) => x.id === t.id); if (p) { t.name = p.name; t.optedOut = p.smsOptOut; } }
    if (t.type === 'contact') { const p = k.find((x) => x.id === t.id); if (p) { t.name = `${p.name} (${p.client.name})`; t.optedOut = p.smsOptOut; } }
    if (t.type === 'lead') { const p = l.find((x) => x.id === t.id); if (p) { t.name = p.contact || p.company; t.optedOut = p.smsOptOut; } }
  }
  return list;
}

const Target = z.object({ type: z.enum(['candidate', 'contact', 'lead']).nullable(), id: z.string().nullable(), phone: z.string().max(30) });

/** One conversation's messages, oldest first; marks incoming ones read. */
export async function thread(tdb: TenantDb, b: z.infer<typeof Target>) {
  const d = last10(b.phone);
  const where = b.type && b.id ? { channel: 'sms', relatedType: b.type, relatedId: b.id } : { channel: 'sms', relatedId: null, OR: [{ fromAddress: { contains: d } }, { toAddress: { contains: d } }] };
  const msgs = await tdb.message.findMany({ where, orderBy: { createdAt: 'asc' }, take: 300, select: { id: true, direction: true, body: true, createdAt: true, status: true, error: true } });
  await tdb.message.updateMany({ where: { ...where, direction: 'in', readAt: null }, data: { readAt: new Date() } });
  return msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));
}

export const ReplyBody = Target.extend({ body: z.string().trim().min(1, 'Write a message.').max(1000, 'Keep texts under 1,000 characters.') });

/** Reply in a conversation. Honors STOP; every attempt is logged. */
export async function reply(tdb: TenantDb, orgId: string, user: User, b: z.infer<typeof ReplyBody>) {
  let party: Party | null = null;
  if (b.type && b.id) party = (await partiesByPhone(tdb, b.phone)).find((p) => p.type === b.type && p.id === b.id) ?? null;
  if (b.type && b.id && !party) throw new HttpError(404, 'That person’s phone number changed or they were deleted.');
  if (party?.smsOptOut) throw new HttpError(409, `${party.name} replied STOP, so they can’t be texted until they reply START.`);
  const to = party?.phone ?? b.phone;
  const log = (data: object) => tdb.message.create({ data: { channel: 'sms', direction: 'out', toAddress: to, body: b.body, relatedType: party?.type ?? null, relatedId: party?.id ?? null, sentById: user.id, ...data } as never });
  try {
    const r = await sendSms(to, b.body);
    await log({ status: 'sent', providerId: r.id });
  } catch (e) {
    await log({ status: 'failed', error: String((e as Error).message).slice(0, 300) });
    throw new HttpError(502, 'The text couldn’t be sent. Check the number and try again.');
  }
  await logActivity(orgId, `Texted ${party?.name ?? to}`, user.id);
}

export const unreadCount = (tdb: TenantDb) => tdb.message.count({ where: { channel: 'sms', direction: 'in', readAt: null } });
