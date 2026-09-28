'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@prisma/client';
import { useRecords } from './Records';

type Member = { id: string; userId: string; name: string | null; email: string; role: Role; since: string };
type Invite = { id: string; email: string; role: Role; expired: boolean; expiresAt: string };
const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', ADMIN: 'Admin', RECRUITER: 'Recruiter', VIEWER: 'Viewer' };
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function Team({ me, admin, members, invites, full }: { me: { id: string; role: Role }; admin: boolean; members: Member[]; invites: Invite[]; full: boolean }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('RECRUITER');
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, body?: unknown, ok?: string) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast(j.error ?? 'Something went wrong.', true); return false; }
    if (ok) toast(ok);
    router.refresh(); return true;
  }
  async function invite(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    if (await call('/api/team/invite', 'POST', { email, role }, `Invite sent to ${email}.`)) setEmail('');
    setBusy(false);
  }
  const roleChoices: Role[] = me.role === 'OWNER' ? ['OWNER', 'ADMIN', 'RECRUITER', 'VIEWER'] : ['ADMIN', 'RECRUITER', 'VIEWER'];

  return (
    <>
      <div className="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th>{admin && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
        {members.map((m) => {
          const self = m.userId === me.id;
          const locked = !admin || self || (m.role === 'OWNER' && me.role !== 'OWNER');
          return (
            <tr key={m.id}>
              <td><b>{m.name ?? '—'}</b>{self && <span className="muted"> (you)</span>}</td>
              <td>{m.email}</td>
              <td>{locked ? ROLE_LABEL[m.role] : (
                <select aria-label={`Role for ${m.email}`} value={m.role} onChange={(e) => call(`/api/team/members/${m.id}`, 'PATCH', { role: e.target.value }, 'Role updated.')}>
                  {roleChoices.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              )}</td>
              <td>{date(m.since)}</td>
              {admin && <td>{!locked && <button className="btn ghost sm" onClick={() => confirm(`Remove ${m.email} from your team?`) && call(`/api/team/members/${m.id}`, 'DELETE', undefined, 'Removed.')}>Remove</button>}</td>}
            </tr>
          );
        })}
      </tbody></table></div>

      {invites.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Pending invites</h2>
          <div className="list">{invites.map((i) => (
            <div key={i.id} className="li"><span className="x"><b>{i.email}</b><span className={i.expired ? 'warn' : 'muted'}>{ROLE_LABEL[i.role]} · {i.expired ? 'Expired' : `Expires ${date(i.expiresAt)}`}</span></span>
              {admin && <span className="row"><button className="btn ghost sm" onClick={() => call('/api/team/invite', 'POST', { email: i.email, role: i.role }, `Invite re-sent to ${i.email}.`)}>Resend</button>
                <button className="btn ghost sm" onClick={() => call(`/api/team/invites/${i.id}`, 'DELETE', undefined, 'Invite revoked.')}>Revoke</button></span>}
            </div>
          ))}</div>
        </section>
      )}

      {admin && (
        <form className="card" onSubmit={invite}>
          <h2 style={{ marginTop: 0 }}>Invite a teammate</h2>
          {full ? <p className="warn">Your plan’s seats are all in use. <a href="/app/billing">Upgrade to add more people.</a></p> : (
            <div className="row" style={{ marginTop: 0 }}>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourcompany.com" aria-label="Email" style={{ flex: 1, minWidth: 220 }} />
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">{(['ADMIN', 'RECRUITER', 'VIEWER'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button>
            </div>
          )}
          <p className="muted">They’ll get an email with a link that works for 7 days.</p>
        </form>
      )}
    </>
  );
}
