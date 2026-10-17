import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { tenantDb, TENANT_MODELS } from '@/lib/tenant';
import { rlsReport } from '@/lib/config-check';

// The second isolation layer: Postgres row-level security under tenantDb(). These tests go around the where-clause
// scoping on purpose (includes, relation filters, raw SQL, a planted cross-company link) to show the database refuses.
const RUN = `rls${Date.now()}`;
let a: string, b: string, clientA: string, clientB: string, jobA: string;

/** Raw SQL as company `org` would run it: inside a transaction with app.org_id set. */
const asOrg = <T,>(org: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  db.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.org_id', ${org}, true)`; return fn(tx); });

beforeAll(async () => {
  a = (await db.organization.create({ data: { name: 'A Staffing', slug: `a-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  b = (await db.organization.create({ data: { name: 'B Staffing', slug: `b-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  clientA = (await db.client.create({ data: { organizationId: a, name: 'A client' } })).id;
  clientB = (await db.client.create({ data: { organizationId: b, name: `B secret ${RUN}` } })).id;
  // A broken link planted underneath the app: A's job points at B's client.
  jobA = (await db.job.create({ data: { organizationId: a, title: 'Forklift', clientId: clientB } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.$disconnect();
});

describe('row-level security policies', () => {
  it('cover every table with organizationId except memberships, and the database user is subject to them', async () => {
    const withOrg = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'organizationId')).map((m) => m.name);
    expect(withOrg.filter((m) => m !== 'Membership' && !TENANT_MODELS.has(m))).toEqual([]);
    expect(await rlsReport((sql) => db.$queryRawUnsafe(sql), [...TENANT_MODELS])).toEqual([]);
  });

  it('flag a superuser connection and a table without a policy', async () => {
    const fake = async (sql: string) => (sql.includes('pg_roles') ? [{ rolname: 'admin', rolsuper: true, rolbypassrls: false }] : [{ relname: 'Job', relrowsecurity: true, relforcerowsecurity: true, policy: true }]);
    expect(await rlsReport(fake, ['Job', 'NewThing'])).toEqual([
      'The database user “admin” is a superuser, so row-level security is skipped. Connect as an ordinary user that owns the tables.',
      'Row-level security is missing on: NewThing. Add a migration like 20…_row_level_security for each new table with organizationId.',
    ]);
  });

  it('hide and protect other companies’ rows in raw SQL once a company is set', async () => {
    const names = await asOrg(a, (tx) => tx.$queryRaw<{ name: string }[]>`SELECT name FROM "Client" WHERE id IN (${clientA}, ${clientB})`);
    expect(names.map((r) => r.name)).toEqual(['A client']);
    expect(await asOrg(a, (tx) => tx.$executeRaw`UPDATE "Client" SET name = 'pwned' WHERE id = ${clientB}`)).toBe(0);
    expect(await asOrg(a, (tx) => tx.$executeRaw`DELETE FROM "Client" WHERE id = ${clientB}`)).toBe(0);
    await expect(asOrg(a, (tx) => tx.$executeRaw`INSERT INTO "Client" (id, "organizationId", name, "createdAt", "updatedAt") VALUES (${`x${RUN}`}, ${b}, 'planted', now(), now())`)).rejects.toThrow(/row-level security/);
    // Moving a row into another company is refused too.
    await expect(asOrg(a, (tx) => tx.$executeRaw`UPDATE "Client" SET "organizationId" = ${b} WHERE id = ${clientA}`)).rejects.toThrow(/row-level security/);
    expect((await db.client.findUnique({ where: { id: clientB } }))?.name).toBe(`B secret ${RUN}`);
  });

  it('leave system code (no company set) unfiltered', async () => {
    expect(await db.client.count({ where: { id: { in: [clientA, clientB] } } })).toBe(2);
  });
});

describe('tenantDb under row-level security', () => {
  it('can’t reach another company through an include or a relation filter', async () => {
    const tdb = tenantDb(a);
    const job = await tdb.job.findFirst({ where: { id: jobA }, include: { client: true } });
    expect(job?.title).toBe('Forklift');
    expect(job?.client).toBeNull(); // the where-clause layer doesn't scope includes; the database does
    expect(await tdb.job.count({ where: { client: { name: `B secret ${RUN}` } } })).toBe(0);
    expect(await db.job.count({ where: { id: jobA, client: { name: `B secret ${RUN}` } } })).toBe(1);
  });

  it('scopes interactive transactions, including raw SQL inside them', async () => {
    const r = await tenantDb(a).$transaction(async (tx) => {
      const made = await tx.client.create({ data: { name: 'Made in tx' } as never });
      const raw = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Client" WHERE id IN (${clientA}, ${clientB}, ${made.id})`;
      return { org: made.organizationId, raw: Number(raw[0].n), list: (await tx.client.findMany({ select: { name: true }, orderBy: { name: 'asc' } })).map((c) => c.name) };
    });
    expect(r).toEqual({ org: a, raw: 2, list: ['A client', 'Made in tx'] });
    await expect(tenantDb(a).$transaction(async (tx) => tx.client.update({ where: { id: clientA }, data: { name: 'x' } }))).rejects.toThrow(/not allowed/);
    expect(() => (tenantDb(a).$transaction as unknown as (x: unknown[]) => unknown)([])).toThrow(/interactive transaction/);
  });

  it('keeps each company’s view separate', async () => {
    expect((await tenantDb(b).client.findMany({ where: { id: { in: [clientA, clientB] } } })).map((c) => c.id)).toEqual([clientB]);
    expect(await tenantDb(b).job.count({ where: { id: jobA } })).toBe(0);
  });
});
