import { publicJobs } from '@/lib/public-jobs';

export const revalidate = 300;
const x = (s: unknown) => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

/** Indeed / ZipRecruiter / Talent.com–style XML feed. Give boards this URL once; it stays current automatically. */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const data = await publicJobs(params.slug);
  if (!data) return new Response('Not found', { status: 404 });
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<source>
<publisher>${x(data.company)}</publisher>
<publisherurl>${x(data.website ?? '')}</publisherurl>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${data.jobs.map((j) => { const [city, state] = (j.location ?? '').split(',').map((s) => s.trim()); return `<job>
<title>${x(j.title)}</title><date>${x(new Date(j.posted).toUTCString())}</date><referencenumber>${x(j.id)}</referencenumber><requisitionid>${x(j.id)}</requisitionid>
<url>${x(j.url)}</url><company>${x(data.company)}</company><city>${x(city)}</city><state>${x(state)}</state><country>US</country>
<description>${x(j.description)}</description><salary>${x(j.pay)}</salary><jobtype>${x(j.type)}</jobtype><category>${x(j.sector)}</category>
</job>`; }).join('\n')}
</source>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, s-maxage=300' } });
}
