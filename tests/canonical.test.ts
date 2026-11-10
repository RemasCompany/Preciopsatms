import { describe, expect, it } from 'vitest';
import { canonicalRedirect } from '@/lib/canonical';
import { productionProblems, sameDatabase } from '../scripts/db-url.mjs';

const at = (u: string) => new URL(u);
const MAIN = 'https://app.preciopsatms.com';

describe('one address for sign-in', () => {
  it('moves pages on the other domains to the main one, keeping the path', () => {
    expect(canonicalRedirect(at('https://preciopsatms.app/login?org=1'), 'preciopsatms.app', MAIN)?.toString()).toBe('https://app.preciopsatms.com/login?org=1');
    expect(canonicalRedirect(at('https://www.preciopsatms.com/signup'), 'www.preciopsatms.com', MAIN)?.toString()).toBe('https://app.preciopsatms.com/signup');
    expect(canonicalRedirect(at('https://preciopsatms.com/'), 'preciopsatms.com:443', MAIN)?.toString()).toBe('https://app.preciopsatms.com/');
  });
  it('leaves the main address, APIs, previews and local development alone', () => {
    expect(canonicalRedirect(at('https://app.preciopsatms.com/login'), 'app.preciopsatms.com', MAIN)).toBeNull();
    expect(canonicalRedirect(at('https://preciopsatms.app/api/stripe/webhook'), 'preciopsatms.app', MAIN)).toBeNull();
    expect(canonicalRedirect(at('https://preciopsatms-abc.vercel.app/login'), 'preciopsatms-abc.vercel.app', MAIN)).toBeNull();
    expect(canonicalRedirect(at('http://localhost:3000/login'), 'localhost:3000', MAIN)).toBeNull();
    expect(canonicalRedirect(at('https://preciopsatms.app/login'), 'preciopsatms.app', undefined)).toBeNull();
    expect(canonicalRedirect(at('https://preciopsatms.app/login'), 'preciopsatms.app', 'not a url')).toBeNull();
  });
});

describe('production deploy check', () => {
  const ok = { NEXTAUTH_SECRET: 'x'.repeat(44), NEXTAUTH_URL: MAIN, APP_URL: `${MAIN}/`, DATABASE_URL: 'postgresql://u:p@ep-a-pooler.neon.tech/neondb?sslmode=require', DIRECT_URL: 'postgresql://u:p@ep-a.neon.tech/neondb?sslmode=require' };
  it('passes a good setup', () => {
    expect(productionProblems(ok)).toEqual([]);
    expect(sameDatabase(ok.DATABASE_URL, ok.DIRECT_URL)).toBe(true);
  });
  it('names what would break sign-in, never the values', () => {
    const p = productionProblems({ ...ok, NEXTAUTH_SECRET: '', APP_URL: 'https://preciopsatms.app', DIRECT_URL: 'postgresql://u:secretpw@ep-b.neon.tech/neondb' });
    expect(p.map((x) => x.split(' ')[0])).toEqual(['NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'DATABASE_URL']);
    expect(p.join(' ')).not.toContain('secretpw');
    expect(productionProblems({ ...ok, NEXTAUTH_URL: 'http://app.preciopsatms.com' })[0]).toMatch(/must be the site’s https:\/\/ address/);
    expect(productionProblems({ ...ok, NEXTAUTH_SECRET: 'short' })[0]).toMatch(/shorter than 32/);
  });
});
