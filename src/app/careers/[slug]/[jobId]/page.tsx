import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { publicJobs } from '@/lib/public-jobs';
import ApplyForm from '@/components/ApplyForm';

export const revalidate = 60;
const EMP: Record<string, string> = { Contract: 'CONTRACTOR', 'Contract-to-hire': 'CONTRACTOR', 'Direct hire': 'FULL_TIME', Temp: 'TEMPORARY', 'Per diem': 'PER_DIEM' };

async function load(slug: string, jobId: string) {
  const d = await publicJobs(slug); const job = d?.jobs.find((j) => j.id === jobId);
  return d && job ? { d, job } : null;
}

export async function generateMetadata({ params }: { params: { slug: string; jobId: string } }): Promise<Metadata> {
  const r = await load(params.slug, params.jobId);
  return r ? { title: `${r.job.title} — ${r.job.location} | ${r.d.company}`, description: r.job.description.slice(0, 155) } : {};
}

/** One page per job: what Google for Jobs indexes best. */
export default async function JobPage({ params }: { params: { slug: string; jobId: string } }) {
  const r = await load(params.slug, params.jobId);
  if (!r) notFound();
  const { d, job } = r; const [city, region] = job.location.split(',').map((s) => s.trim());
  const ld = {
    '@context': 'https://schema.org/', '@type': 'JobPosting', title: job.title, description: job.description.replace(/\n/g, '<br>'), datePosted: job.posted,
    employmentType: EMP[job.type] ?? 'OTHER', hiringOrganization: { '@type': 'Organization', name: d.company, sameAs: d.website ?? undefined },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: city, addressRegion: region, addressCountry: 'US' } },
    identifier: { '@type': 'PropertyValue', name: d.company, value: job.id }, directApply: true,
    ...(job.payRate ? { baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', value: job.payRate, unitText: 'HOUR' } } } : {}),
  };
  return (
    <main className="public" style={{ ['--accent' as string]: d.accent }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <p className="muted"><a href={`/careers/${params.slug}`}>← All jobs at {d.company}</a></p>
      <h1>{job.title}</h1>
      <p className="muted">{[job.location, job.type, job.pay, job.client].filter(Boolean).join(' · ')}</p>
      <div className="desc">{job.description.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>
      {job.skills.length > 0 && <p className="tags">{job.skills.map((s) => <span key={s}>{s}</span>)}</p>}
      {job.url.startsWith(process.env.APP_URL ?? '') ? <ApplyForm slug={params.slug} jobId={job.id} company={d.company} /> : <a className="btn" href={job.url}>Apply now</a>}
    </main>
  );
}
