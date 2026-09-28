import { db } from '@/lib/db';
import { requirePageContext } from '@/lib/tenant';

export default async function Team() {
  const { org } = await requirePageContext();
  const members = await db.membership.findMany({ where: { organizationId: org.id }, include: { user: true }, orderBy: { createdAt: 'asc' } });
  return (
    <>
      <h1>Team</h1>
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
        {members.map((m) => <tr key={m.id}><td>{m.user.name}</td><td>{m.user.email}</td><td>{m.role.toLowerCase()}</td></tr>)}
      </tbody></table>
      <p className="muted">Invite teammates with POST /api/team/invite (UI to be ported — see CLAUDE.md).</p>
    </>
  );
}
