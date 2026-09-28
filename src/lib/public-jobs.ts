import { db } from './db';

const TYPE_LABEL: Record<string, string> = { CONTRACT: 'Contract', CONTRACT_TO_HIRE: 'Contract-to-hire', DIRECT_HIRE: 'Direct hire', TEMP: 'Temp', PER_DIEM: 'Per diem' };

/** The only data ever exposed publicly. No client names unless the org opts in; no bill rates, ever. */
export async function publicJobs(slug: string) {
  const org = await db.organization.findUnique({ where: { slug } });
  if (!org || !['trialing', 'active'].includes(org.subscriptionStatus)) return null;
  const jobs = await db.job.findMany({ where: { organizationId: org.id, status: 'OPEN', publish: true }, include: { client: { select: { name: true } } }, orderBy: [{ hot: 'desc' }, { createdAt: 'desc' }] });
  const base = `${process.env.APP_URL}/careers/${org.slug}`;
  return {
    company: org.name, website: org.website, headline: org.careersHeadline, intro: org.careersIntro, accent: org.brandColor, email: org.applyEmail,
    jobs: jobs.map((j) => ({
      id: j.id, title: j.title, location: j.location ?? '', type: TYPE_LABEL[j.type], sector: j.sector ?? '',
      pay: org.showPayOnCareers && j.payRate ? `$${Number(j.payRate).toFixed(2).replace(/\.00$/, '')}/hr` : '',
      payRate: org.showPayOnCareers && j.payRate ? Number(j.payRate) : 0,
      client: org.showClientOnCareers ? j.client?.name ?? '' : '',
      description: j.posting ?? j.description ?? '', skills: j.skills, posted: j.createdAt.toISOString().slice(0, 10), hot: j.hot,
      url: j.applyUrl || `${base}/${j.id}`,
    })),
  };
}
