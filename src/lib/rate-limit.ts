/**
 * Rate limits for public and sign-in endpoints.
 * With UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set, counts are shared by every server instance (fixed windows in Redis).
 * Without them, or if Redis doesn't answer within a second, each instance counts on its own in memory.
 */
const buckets = new Map<string, Map<string, number[]>>();

function memoryLimited(bucket: string, key: string, max: number, windowMs: number) {
  const hits = buckets.get(bucket) ?? new Map<string, number[]>(); buckets.set(bucket, hits);
  const now = Date.now(); const h = (hits.get(key) ?? []).filter((t) => now - t < windowMs); h.push(now); hits.set(key, h);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); // don't grow forever
  return h.length > max;
}

let warned = false;
async function redisCount(key: string, windowMs: number): Promise<number | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['PEXPIRE', key, String(windowMs), 'NX']]),
      signal: AbortSignal.timeout(1000), cache: 'no-store',
    });
    if (!r.ok) throw new Error(`Upstash answered ${r.status}`);
    const [incr] = (await r.json()) as { result?: number; error?: string }[];
    if (typeof incr?.result !== 'number') throw new Error(incr?.error ?? 'Unexpected Upstash reply');
    return incr.result;
  } catch (e) {
    if (!warned) { warned = true; console.warn('[rate-limit] Upstash unavailable, counting in memory:', (e as Error).message); }
    return null;
  }
}

/** True when this call is over `max` per `windowMs` for bucket + key (e.g. an IP address or email). */
export async function limited(bucket: string, key: string, max: number, windowMs = 600e3) {
  const n = await redisCount(`rl:${bucket}:${key}:${Math.floor(Date.now() / windowMs)}`, windowMs);
  return n === null ? memoryLimited(bucket, key, max, windowMs) : n > max;
}
