import type { TenantDb } from './tenant';

/** Approved time off on any of these days, for the person behind a shift (so it can't be scheduled over). */
export async function onLeave(tdb: TenantDb, candidateId: string, dates: string[]) {
  if (!dates.length) return null;
  const e = await tdb.leaveEntry.findFirst({ where: { kind: 'USAGE', employee: { candidateId }, date: { in: dates.map((d) => new Date(`${d}T00:00:00Z`)) } }, orderBy: { date: 'asc' }, include: { policy: { select: { name: true } } } });
  return e ? { date: e.date.toISOString().slice(0, 10), policy: e.policy.name } : null;
}
