import { securityContact } from '@/lib/security-contact';

/** RFC 9116 security.txt: where to report vulnerabilities. */
export function GET() {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  const expires = new Date(Date.now() + 180 * 864e5).toISOString();
  return new Response(`Contact: mailto:${securityContact()}\nExpires: ${expires}\nPreferred-Languages: en\nPolicy: ${base}/security\nCanonical: ${base}/.well-known/security.txt\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
