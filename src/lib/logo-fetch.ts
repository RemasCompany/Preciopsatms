import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Fetching a company's logo (an https URL they typed in Settings) to print on invoices. The URL is user input, so this
// refuses anything that resolves to a private, loopback or link-local address, doesn't follow redirects, and caps size.
const MAX_BYTES = 1024 * 1024;
const cache = new Map<string, { at: number; logo: { bytes: Uint8Array; png: boolean } | null }>();

export function isPrivateAddress(ip: string) {
  const v = ip.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

/** The logo as PNG or JPEG bytes, or null when it can't be fetched safely. Never throws. */
export async function fetchLogo(url: string | null | undefined, ttlMs = 10 * 60e3) {
  if (!url) return null;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.logo;
  let logo: { bytes: Uint8Array; png: boolean } | null = null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error('not https');
    const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('private address');
    const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(3000), headers: { Accept: 'image/png,image/jpeg' } });
    if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('too big');
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) { size += c.length; if (size > MAX_BYTES) throw new Error('too big'); chunks.push(c); }
    const bytes = Buffer.concat(chunks);
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (png || jpg) logo = { bytes: new Uint8Array(bytes), png };
  } catch { logo = null; }
  cache.set(url, { at: Date.now(), logo });
  return logo;
}
