import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { publicJobs } from '@/lib/public-jobs';

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const d = await publicJobs(params.slug);
  return d ? { title: `Careers | ${d.company}`, description: d.intro ?? `Open jobs at ${d.company}` } : {};
}

export default async function Careers({ params }: { params: { slug: string } }) {
  const d = await publicJobs(params.slug);
  if (!d) notFound();
  return (
    <main className="public" style={{ ['--accent' as string]: d.accent }}>
      {d.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.logo} alt={d.company} className="careers-logo" />
      )}
      <h1>{d.headline}</h1>
      {d.intro && <p className="lede">{d.intro}</p>}
      <p className="muted">{d.jobs.length} open {d.jobs.length === 1 ? 'role' : 'roles'} at {d.company}</p>
      <ul className="joblist">
        {d.jobs.map((j) => (
          <li key={j.id}>
            <Link href={`/careers/${params.slug}/${j.id}`}>
              <strong>{j.title}</strong>{j.hot && <span className="hot">Hiring now</span>}
              <span className="muted">{[j.location, j.type, j.pay].filter(Boolean).join(' · ')}</span>
            </Link>
          </li>
        ))}
      </ul>
      {!d.jobs.length && <p className="muted">No open roles right now.{d.email ? ` Send your resume to ${d.email}.` : ''}</p>}
    </main>
  );
}
