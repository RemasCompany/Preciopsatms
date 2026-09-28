import { publicJobs } from '@/lib/public-jobs';

export const revalidate = 60;

/** Public JSON used by the embeddable careers widget on customers' websites. */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const data = await publicJobs(params.slug);
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 });
  const { indeedApplyApiToken: _t, ...pub } = data;
  return Response.json(pub, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
export function OPTIONS() { return new Response(null, { status: 204 }); }
