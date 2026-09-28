import { requirePageContext, canEdit } from '@/lib/tenant';
import SettingsForm from '@/components/SettingsForm';
import DataTools from '@/components/DataTools';
import JobBoards from '@/components/JobBoards';
import { feedWarnings } from '@/lib/job-boards';

export default async function Settings() {
  const ctx = await requirePageContext();
  const { org, tdb, role } = ctx;
  const [openJobs, published, emailApply, feedJobs] = await Promise.all([
    tdb.job.count({ where: { status: 'OPEN' } }),
    tdb.job.count({ where: { status: 'OPEN', publish: true } }),
    tdb.job.count({ where: { status: 'OPEN', publish: true, OR: [{ applyUrl: null }, { applyUrl: '' }] } }),
    tdb.job.findMany({ where: { status: 'OPEN', publish: true }, select: { id: true, title: true, location: true, remote: true, description: true, posting: true } }),
  ]);
  const warnings = feedWarnings(feedJobs.map((j) => ({ id: j.id, title: j.title, location: j.location ?? '', remote: j.remote, description: j.posting ?? j.description ?? '' })));
  const admin = (role === 'OWNER' || role === 'ADMIN') && canEdit(ctx);
  const base = process.env.APP_URL ?? '';
  const pick = ({ name, shortName, ownerName, ownerTitle, city, website, services, pitch, logoUrl, brandColor, applyEmail, careersHeadline, careersIntro, showPayOnCareers, showClientOnCareers }: typeof org) =>
    ({ name, shortName, ownerName, ownerTitle, city, website, services, pitch, logoUrl, brandColor, applyEmail, careersHeadline, careersIntro, showPayOnCareers, showClientOnCareers });
  return (
    <>
      <h1>Settings & data</h1>
      <p className="lede">Your company profile brands the app, emails, documents, invoices and careers page. Import and export your records here.</p>
      <SettingsForm initial={pick(org)} readOnly={!admin} />
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Careers page, widget and job feed</h2>
        <div className="kpis">
          <div className="kpi"><b>{published}</b><span>Jobs on your careers page</span></div>
          <div className="kpi"><b>{openJobs - published}</b><span>Open jobs hidden</span></div>
          <div className="kpi"><b>{emailApply}</b><span>Apply on your careers page</span></div>
        </div>
        <label><span>Careers page</span><input readOnly value={`${base}/careers/${org.slug}`} /></label>
        <label><span>Embed on your website</span><textarea readOnly rows={2} value={`<div id="preci-careers" data-org="${org.slug}"></div><script src="${base}/embed.js" async></script>`} /></label>
        <p className="muted">The page and widget update automatically as jobs open and close. Uncheck “Show on careers page” on a job to keep it internal.</p>
      </section>
      <JobBoards base={base} slug={org.slug} readOnly={!admin} indeed={{ apiToken: org.indeedApplyApiToken, hasSecret: !!org.indeedApplySecret }} warnings={warnings} />
      <DataTools canImport={canEdit(ctx) && role !== 'VIEWER'} owner={role === 'OWNER'} />
    </>
  );
}
