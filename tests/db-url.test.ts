import { describe, expect, it } from 'vitest';
import { cleanUrl, pickDatabaseUrls } from '../scripts/db-url.mjs';

const POOLED = 'postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';
const DIRECT = 'postgresql://u:p@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require';

describe('database connection strings', () => {
  it('cleans what people paste from a dashboard', () => {
    expect(cleanUrl(` "${POOLED}" `)).toBe(POOLED);
    expect(cleanUrl(`psql '${DIRECT}'`)).toBe(DIRECT);
    expect(cleanUrl('postgres://a@b/c')).toBe('postgres://a@b/c');
    expect(cleanUrl('')).toBeNull();
    expect(cleanUrl('neondb')).toBeNull();
    expect(cleanUrl('https://console.neon.tech/app/projects/x')).toBeNull();
  });

  it('uses a direct string for migrations and the pooled one at runtime', () => {
    expect(pickDatabaseUrls({ DATABASE_URL: POOLED, DIRECT_URL: DIRECT })).toMatchObject({ runtime: POOLED, migrate: DIRECT, migrateFrom: 'DIRECT_URL', problems: [] });
    expect(pickDatabaseUrls({ DATABASE_URL: POOLED })).toMatchObject({ runtime: POOLED, migrate: POOLED, migrateFrom: 'DATABASE_URL' });
  });

  it('finds the names Vercel’s Neon integration uses', () => {
    expect(pickDatabaseUrls({ POSTGRES_PRISMA_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT })).toMatchObject({ runtime: POOLED, runtimeFrom: 'POSTGRES_PRISMA_URL', migrate: DIRECT, migrateFrom: 'DATABASE_URL_UNPOOLED' });
    expect(pickDatabaseUrls({ POSTGRES_URL: POOLED, POSTGRES_URL_NON_POOLING: DIRECT })).toMatchObject({ runtime: POOLED, migrate: DIRECT });
  });

  it('skips a broken value (the P1012 case) and says which one, without the value', () => {
    const r = pickDatabaseUrls({ DIRECT_URL: 'neondb', DATABASE_URL: POOLED });
    expect(r).toMatchObject({ migrate: POOLED, migrateFrom: 'DATABASE_URL' });
    expect(r.problems).toEqual(['DIRECT_URL is set but isn\'t a postgres:// connection string']);
    expect(pickDatabaseUrls({})).toMatchObject({ runtime: null, migrate: null });
  });
});
