// One address for the app. The site answers on several domains (preciopsatms.com, preciopsatms.app, www.…), but a
// sign-in cookie only belongs to the domain that set it and next-auth sends people back to NEXTAUTH_URL, so signing in
// on any other domain loses the session. Pages on those domains move to APP_URL's. Pure (runs in middleware; tested).

/** Where to send this request instead, or null to serve it here. */
export function canonicalRedirect(url: URL, host: string | null, appUrl: string | undefined) {
  if (!appUrl || !host) return null;
  let target: URL;
  try { target = new URL(appUrl); } catch { return null; }
  const here = host.toLowerCase().split(':')[0], there = target.hostname.toLowerCase();
  if (here === there) return null;
  // Previews, local development and direct IPs are left alone.
  if (here === 'localhost' || here.endsWith('.vercel.app') || /^[\d.]+$/.test(here) || /^\[?[0-9a-f:]+\]?$/.test(here)) return null;
  // API routes (webhooks, feeds, the embed) keep working on whatever address they were given.
  if (url.pathname.startsWith('/api/')) return null;
  return new URL(`${url.pathname}${url.search}`, target.origin);
}
