import { requirePageContext } from '@/lib/tenant';

export default async function Candidates({ searchParams }: { searchParams: { q?: string } }) {
  const { tdb } = await requirePageContext();
  const q = searchParams.q?.trim();
  const list = await tdb.candidate.findMany({ where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }, { skills: { has: q } }] } : {}, orderBy: { updatedAt: 'desc' }, take: 100 });
  return (
    <>
      <h1>Candidates</h1>
      <form><input name="q" defaultValue={q} placeholder="Search name, title or exact skill" /> <button className="btn ghost">Search</button></form>
      <table style={{ marginTop: 14 }}><thead><tr><th>Name</th><th>Title</th><th>Skills</th><th>Source</th><th>Status</th></tr></thead><tbody>
        {list.map((c) => <tr key={c.id}><td><b>{c.name}</b><br /><span className="muted">{c.email}</span></td><td>{c.title}</td><td>{c.skills.slice(0, 4).join(', ')}</td><td>{c.source}</td><td>{c.status}</td></tr>)}
      </tbody></table>
    </>
  );
}
