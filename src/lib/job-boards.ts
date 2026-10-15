import { createHmac, timingSafeEqual } from 'crypto';
import type { TenantDb } from './tenant';
import { BOARDS, BOARD_INFO, isBoard, postsTo, type Board } from './boards';
export { BOARDS, isBoard, type Board };

/**
 * Job-board syndication. One XML feed in Indeed's Job Sync format, which ZipRecruiter, Talent.com, Jooble,
 * Careerjet, Adzuna and most aggregators also accept. Each board gets its own feed URL (?board=…) so apply
 * links carry the board as a source and applicants are attributed to it.
 */
/** Where an applicant came from, from the ?src= on the apply link. */
export const sourceFor = (src: string | null | undefined) => (isBoard(src) ? BOARDS[src] : src === 'google' ? 'Google for Jobs' : 'Careers page');

// Indeed's <jobtype> values.
const JOBTYPE: Record<string, string> = { CONTRACT: 'contract', CONTRACT_TO_HIRE: 'contract', DIRECT_HIRE: 'fulltime', TEMP: 'temporary', PER_DIEM: 'parttime', FULL_TIME: 'fulltime', PART_TIME: 'parttime', SEASONAL: 'temporary' };

export type FeedJob = {
  id: string; title: string; type: string; location: string; postalCode: string | null; remote: boolean; sector: string;
  description: string; payRate: number; posted: string; url: string; external: boolean; boards?: string[];
};
export type FeedOrg = { company: string; website: string | null; email: string | null; slug: string; indeedApplyApiToken: string | null; jobBoards?: string[]; linkedinCompanyId?: string | null };

export function splitLocation(location: string) {
  const [city = '', state = ''] = location.split(',').map((s) => s.trim());
  return { city, state };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Plain-text description → the simple HTML boards render (paragraphs and line breaks). */
export const descriptionHtml = (text: string) =>
  text.trim().split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') || '<p></p>';

const cdata = (s: unknown) => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

export function withSource(url: string, board: Board | null) {
  if (!board) return url;
  const u = new URL(url); u.searchParams.set('src', board); u.searchParams.set('utm_source', board); u.searchParams.set('utm_medium', 'job_board');
  return u.toString();
}

/** Indeed Apply parameters for one job: URL-encoded values, & and = left as delimiters. */
export function indeedApplyData(job: FeedJob, org: FeedOrg, appUrl: string) {
  const { city, state } = splitLocation(job.location);
  const params: [string, string][] = [
    ['indeed-apply-apiToken', org.indeedApplyApiToken!], ['indeed-apply-jobId', job.id], ['indeed-apply-jobTitle', job.title],
    ['indeed-apply-jobCompanyName', org.company], ['indeed-apply-jobLocation', job.remote ? 'Remote' : [city, state].filter(Boolean).join(' ') || 'United States'],
    ['indeed-apply-jobUrl', job.url], ['indeed-apply-postUrl', `${appUrl}/api/public/${org.slug}/indeed-apply`],
  ];
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/**
 * The XML feed for one board (or, with no board, every published job for any aggregator). A board that's turned off
 * gets an empty feed, so it drops the jobs; a job posted only to some boards appears only in their feeds.
 * Jobs with an external apply link keep it and never get Indeed Apply.
 */
export function buildFeed(org: FeedOrg, all: FeedJob[], board: Board | null, appUrl: string, now = new Date()) {
  const jobs = board ? all.filter((j) => postsTo(org.jobBoards ?? [], j.boards ?? [], board)) : all;
  if (board && BOARD_INFO[board].format === 'linkedin') return linkedInFeed(org, jobs, appUrl, now);
  const indeedApply = !!org.indeedApplyApiToken && (board === null || board === 'indeed');
  const items = jobs.map((j) => {
    const { city, state } = splitLocation(j.location);
    const url = j.external ? j.url : withSource(j.url, board);
    const tags = [
      ['title', j.title], ['date', new Date(`${j.posted}T00:00:00Z`).toUTCString()], ['referencenumber', j.id], ['requisitionid', j.id],
      ['url', url], ['company', org.company], ['sourcename', org.company],
      ['city', j.remote ? 'Remote' : city], ['state', state], ['country', 'US'], ['postalcode', j.postalCode ?? ''],
      ['email', org.email ?? ''], ['description', descriptionHtml(j.description || j.title)],
      ['salary', j.payRate ? `$${j.payRate.toFixed(2).replace(/\.00$/, '')} per hour` : ''], ['jobtype', JOBTYPE[j.type] ?? ''], ['category', j.sector],
      ...(j.remote ? [['remotetype', 'Fully remote']] : []),
    ].map(([k, v]) => `<${k}>${cdata(v)}</${k}>`).join('');
    const apply = indeedApply && !j.external ? `<indeed-apply-data>${cdata(indeedApplyData({ ...j, url }, org, appUrl))}</indeed-apply-data>` : '';
    return `<job>${tags}${apply}</job>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<source>
<publisher>${cdata(org.company)}</publisher>
<publisherurl>${cdata(org.website ?? `${appUrl}/careers/${org.slug}`)}</publisherurl>
<lastBuildDate>${now.toUTCString()}</lastBuildDate>
${items.join('\n')}
</source>`;
}

/** Jobs a board would bury or reject, with the reason, so recruiters can fix them before syndicating. */
export function feedWarnings(jobs: { id: string; title: string; location: string; remote: boolean; description: string }[]) {
  const out: { id: string; title: string; problem: string }[] = [];
  for (const j of jobs) {
    const { city, state } = splitLocation(j.location);
    if (!j.remote && (!city || !/^[A-Za-z]{2}$/.test(state))) out.push({ id: j.id, title: j.title, problem: 'Add a location as “City, ST” (or mark it remote) — boards hide jobs without a city and state.' });
    if (j.description.trim().length < 100) out.push({ id: j.id, title: j.title, problem: 'Write a longer description (at least a few sentences) — very short postings are often rejected.' });
  }
  return out;
}

/** Verifies Indeed's X-Indeed-Signature: Base64(HMAC-SHA1(raw body, shared secret)). */
export function verifyIndeedSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha1', secret).update(rawBody, 'utf8').digest('base64'));
  const given = Buffer.from(signature.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// LinkedIn's job types and workplace types.
const LI_TYPE: Record<string, string> = { FULL_TIME: 'FULL_TIME', DIRECT_HIRE: 'FULL_TIME', PART_TIME: 'PART_TIME', CONTRACT: 'CONTRACT', CONTRACT_TO_HIRE: 'CONTRACT', TEMP: 'TEMPORARY', SEASONAL: 'TEMPORARY', PER_DIEM: 'TEMPORARY' };

/** LinkedIn's job XML feed format (partner job feeds, Limited Listings and job slots). */
export function linkedInFeed(org: FeedOrg, jobs: FeedJob[], appUrl: string, now = new Date()) {
  const items = jobs.map((j) => {
    const { city, state } = splitLocation(j.location);
    const tags: [string, unknown][] = [
      ['partnerJobId', j.id], ['company', org.company], ...(org.linkedinCompanyId ? [['companyId', org.linkedinCompanyId] as [string, unknown]] : []),
      ['title', j.title], ['description', descriptionHtml(j.description || j.title)], ['applyUrl', j.external ? j.url : withSource(j.url, 'linkedin')],
      ['location', j.remote ? 'United States' : [city, state, 'US'].filter(Boolean).join(', ')], ['city', j.remote ? '' : city], ['state', j.remote ? '' : state], ['country', 'US'], ['postalCode', j.postalCode ?? ''],
      ['jobtype', LI_TYPE[j.type] ?? 'OTHER'], ['workplaceTypes', j.remote ? 'Remote' : 'On-site'], ['listDate', j.posted],
    ];
    const salary = j.payRate ? `<salaries><salary><highEnd><amount>${j.payRate.toFixed(2)}</amount><currencyCode>USD</currencyCode></highEnd><lowEnd><amount>${j.payRate.toFixed(2)}</amount><currencyCode>USD</currencyCode></lowEnd><period>HOURLY</period><type>BASE_SALARY</type></salary></salaries>` : '';
    return `<job>${tags.map(([k, v]) => `<${k}>${cdata(v)}</${k}>`).join('')}${salary}</job>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<source>
<lastBuildDate>${now.toUTCString()}</lastBuildDate>
<publisherUrl>${cdata(org.website ?? `${appUrl}/careers/${org.slug}`)}</publisherUrl>
<publisher>${cdata(org.company)}</publisher>
<expectedJobCount>${jobs.length}</expectedJobCount>
${items.join('\n')}
</source>`;
}

/** Where an application came from, as stored on it: a board key, google, or careers. */
export const sourceKey = (src: string | null | undefined) => (isBoard(src) ? src : src === 'google' ? 'google' : 'careers');

/** Applicants and hires per source over the last `days` days, for judging which boards are worth it. */
export async function boardStats(tdb: TenantDb, days = 90, jobId?: string) {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await tdb.application.groupBy({ by: ['source', 'stage'], where: { createdAt: { gte: since }, source: { not: null }, ...(jobId ? { jobId } : {}) }, _count: { _all: true } });
  const out: Record<string, { applicants: number; hired: number }> = {};
  for (const r of rows) {
    const k = r.source!;
    out[k] ??= { applicants: 0, hired: 0 };
    out[k].applicants += r._count._all;
    if (r.stage === 'PLACED') out[k].hired += r._count._all;
  }
  return out;
}
