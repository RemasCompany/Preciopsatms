import { resolveWorkerLink } from '@/lib/schedule-server';

/** Lets a worker add their own page to their phone's home screen, opening straight to it like an app. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const link = await resolveWorkerLink(params.token);
  if (!link) return Response.json({ error: 'This link has expired.' }, { status: 404 });
  const o = link.organization, name = o.shortName ?? o.name, color = /^#[0-9a-f]{6}$/i.test(o.brandColor ?? '') ? o.brandColor : '#152238';
  return new Response(JSON.stringify({
    name: `${name} — my work`, short_name: name.slice(0, 12), description: 'Your schedule, time clock, pay and documents.',
    start_url: `/shifts/${params.token}`, scope: '/shifts/', id: `/shifts/${params.token}`, display: 'standalone', background_color: '#ffffff', theme_color: color,
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'private, max-age=3600' } });
}
