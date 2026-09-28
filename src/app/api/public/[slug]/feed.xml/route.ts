import { publicJobs } from '@/lib/public-jobs';
import { buildFeed, isBoard } from '@/lib/job-boards';

export const revalidate = 300;

/**
 * Job-board feed in Indeed's XML format (also read by ZipRecruiter, Talent.com, Jooble, Careerjet, Adzuna…).
 * Give each board its own URL with ?board=<name> so its applicants are attributed to it. Always current.
 */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const data = await publicJobs(params.slug);
  if (!data) return new Response('Not found', { status: 404 });
  const b = new URL(req.url).searchParams.get('board');
  const xml = buildFeed(
    { company: data.company, website: data.website, email: data.email, slug: data.slug, indeedApplyApiToken: data.indeedApplyApiToken },
    data.jobs.map((j) => ({ id: j.id, title: j.title, type: j.rawType, location: j.location, postalCode: j.postalCode, remote: j.remote, sector: j.sector, description: j.description, payRate: j.payRate, posted: j.posted, url: j.url, external: j.external })),
    isBoard(b) ? b : null, process.env.APP_URL ?? '',
  );
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, s-maxage=300' } });
}
