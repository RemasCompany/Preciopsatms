import { randomBytes } from 'crypto';

/**
 * Error reporting to Sentry, turned on by SENTRY_DSN. Uses Sentry's envelope API directly (no SDK, no build step).
 * Nothing personal is sent: emails, phone numbers and long digit runs are masked, URLs lose their query strings,
 * worker/client link tokens are cut from paths, and only the user's internal id is attached.
 */
type Extra = { route?: string; method?: string; orgId?: string; userId?: string; tags?: Record<string, string>; platform?: 'node' | 'javascript'; level?: 'error' | 'warning' };

export const scrub = (s: string) => s
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
  .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]')
  .replace(/\/(shifts|feedback|invite|reset|verify|sign|client)\/[\w-]{16,}/g, '/$1/[token]');

export const cleanPath = (url: string) => { try { return scrub(new URL(url, 'http://x').pathname); } catch { return '(unknown)'; } };

function parseDsn(dsn: string) {
  const m = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(.+)$/);
  return m ? { key: m[2], endpoint: `${m[1]}://${m[3]}/api/${m[4]}/envelope/` } : null;
}

export function frames(stack?: string) {
  return (stack ?? '').split('\n').slice(1, 40).map((l) => {
    const m = l.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
    return m ? { function: m[1] ?? '?', filename: m[2].replace(/^.*\/(src|node_modules)\//, '$1/'), lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2].includes('node_modules') } : null;
  }).filter(Boolean).reverse();
}

/** The Sentry event for an error, already scrubbed. Exported for tests. */
export function buildEvent(err: unknown, x: Extra = {}) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  return {
    event_id: randomBytes(16).toString('hex'), timestamp: Date.now() / 1000, platform: x.platform ?? 'node', level: x.level ?? 'error',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development', release: process.env.VERCEL_GIT_COMMIT_SHA,
    exception: { values: [{ type: e.name, value: scrub(e.message).slice(0, 1000), stacktrace: { frames: frames(e.stack) } }] },
    tags: { ...(x.route ? { route: x.route } : {}), ...(x.method ? { method: x.method } : {}), ...(x.orgId ? { org: x.orgId } : {}), ...x.tags },
    user: x.userId ? { id: x.userId } : undefined,
  };
}

let sending = 0;
/** Reports an error (and always logs it). Never throws; gives up after 2 seconds. */
export async function captureError(err: unknown, x: Extra = {}) {
  console.error(x.route ? `[error] ${x.method ?? ''} ${x.route}` : '[error]', err);
  const dsn = process.env.SENTRY_DSN && parseDsn(process.env.SENTRY_DSN);
  if (!dsn || sending > 20) return; // a flood of errors shouldn't pile up requests
  const event = buildEvent(err, x);
  sending++;
  try {
    const body = `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
    await fetch(dsn.endpoint, { method: 'POST', body, signal: AbortSignal.timeout(2000),
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=preciops/1.0` } });
  } catch (e) {
    console.warn('[monitoring] could not reach Sentry:', (e as Error).message);
  } finally { sending--; }
}
