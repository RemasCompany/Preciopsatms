// Simple per-instance rate limit for public endpoints. Replace with Upstash/Redis in production (see CLAUDE.md).
const buckets = new Map<string, Map<string, number[]>>();
export function limited(bucket: string, key: string, max: number, windowMs = 600e3) {
  const hits = buckets.get(bucket) ?? new Map<string, number[]>(); buckets.set(bucket, hits);
  const now = Date.now(); const h = (hits.get(key) ?? []).filter((t) => now - t < windowMs); h.push(now); hits.set(key, h);
  return h.length > max;
}
