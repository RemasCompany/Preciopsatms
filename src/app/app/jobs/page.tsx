import { revalidatePath } from 'next/cache';
import { requirePageContext, logActivity } from '@/lib/tenant';
import { JobInput } from '@/lib/schemas';

async function createJob(form: FormData) {
  'use server';
  const { tdb, org, user } = await requirePageContext('RECRUITER');
  const data = JobInput.parse({ title: form.get('title'), location: form.get('location') || undefined, type: form.get('type'), payRate: form.get('payRate') || undefined, billRate: form.get('billRate') || undefined, openings: form.get('openings') || 1, skills: String(form.get('skills') ?? '').split(',').map((s) => s.trim()).filter(Boolean), description: form.get('description') || undefined });
  const job = await tdb.job.create({ data: data as never });
  await logActivity(org.id, `Added job ${job.title}`, user.id);
  revalidatePath('/app/jobs');
}

export default async function Jobs() {
  const { tdb, org } = await requirePageContext();
  const jobs = await tdb.job.findMany({ include: { client: true, _count: { select: { applications: true } } }, orderBy: [{ hot: 'desc' }, { createdAt: 'desc' }] });
  return (
    <>
      <h1>Jobs</h1>
      <p className="muted">Public careers page: <a href={`/careers/${org.slug}`}>/careers/{org.slug}</a> · Job board feed: <code>/api/public/{org.slug}/feed.xml</code></p>
      <table><thead><tr><th>Job</th><th>Location</th><th>Pipeline</th><th>Spread</th><th>Status</th></tr></thead><tbody>
        {jobs.map((j) => <tr key={j.id}><td><b>{j.title}</b><br /><span className="muted">{j.client?.name}</span></td><td>{j.location}</td><td>{j._count.applications}</td>
          <td>{j.billRate && j.payRate ? `$${(Number(j.billRate) - Number(j.payRate)).toFixed(2)}/hr` : '—'}</td><td>{j.status.replace('_', ' ').toLowerCase()}</td></tr>)}
      </tbody></table>
      <form className="card" action={createJob}>
        <h2>Add a job</h2>
        <label>Title<input name="title" required /></label>
        <label>Location<input name="location" placeholder="City, ST" /></label>
        <label>Type<select name="type" defaultValue="CONTRACT"><option value="CONTRACT">Contract</option><option value="CONTRACT_TO_HIRE">Contract-to-hire</option><option value="DIRECT_HIRE">Direct hire</option><option value="TEMP">Temp</option><option value="PER_DIEM">Per diem</option></select></label>
        <label>Openings<input name="openings" type="number" min={1} defaultValue={1} /></label>
        <label>Pay rate ($/hr)<input name="payRate" type="number" step="0.01" /></label>
        <label>Bill rate ($/hr)<input name="billRate" type="number" step="0.01" /></label>
        <label>Skills (comma separated)<input name="skills" /></label>
        <label>Description<textarea name="description" rows={4} /></label>
        <button className="btn">Add job</button>
      </form>
    </>
  );
}
