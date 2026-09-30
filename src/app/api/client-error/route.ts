import { z } from 'zod';
import { captureError, cleanPath } from '@/lib/monitoring';
import { limited } from '@/lib/rate-limit';

const Body = z.object({ message: z.string().max(1000), stack: z.string().max(8000).optional(), path: z.string().max(500), digest: z.string().max(100).optional() });

/** Browser crashes caught by the error pages, forwarded to monitoring (scrubbed, rate-limited). */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (await limited('client-error', ip, 20, 600e3)) return new Response(null, { status: 204 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return new Response(null, { status: 204 });
  const e = new Error(b.data.message); e.name = 'BrowserError'; e.stack = `${e.name}: ${b.data.message}\n${b.data.stack ?? ''}`;
  await captureError(e, { platform: 'javascript', route: cleanPath(b.data.path), tags: b.data.digest ? { digest: b.data.digest } : undefined });
  return new Response(null, { status: 204 });
}
