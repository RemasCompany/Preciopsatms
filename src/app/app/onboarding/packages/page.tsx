import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { STARTER_PACKAGES, type StepDef } from '@/lib/onboarding';
import { CREDENTIAL_TYPE_NAMES } from '@/lib/credentials';
import { PackageEditor, AddStarter } from '@/components/Onboarding';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';

export default async function Packages() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'onboarding')) return <Gate title="Onboarding packages" feature="New-hire onboarding" />;
  const packages = await ctx.tdb.onboardingPackage.findMany({ where: { archived: false }, orderBy: { name: 'asc' } });
  const admin = (ctx.role === 'OWNER' || ctx.role === 'ADMIN') && canEdit(ctx);
  const have = new Set(packages.map((p) => p.name));
  return (
    <>
      <p className="muted" style={{ margin: 0 }}><Link href="/app/onboarding">← Onboarding</Link></p>
      <h1>Onboarding packages</h1>
      <p className="lede">The steps each kind of new hire goes through. Documents merge in the new hire’s name, job, pay rate and start date. Have your attorney review document text before you use it; changes apply to onboardings you start afterwards.</p>
      {admin && (
        <div className="bar">
          {STARTER_PACKAGES.map((s, i) => !have.has(s.name) && <AddStarter key={s.name} index={i} name={s.name} />)}
          <PackageEditor credentialTypes={CREDENTIAL_TYPE_NAMES} />
        </div>
      )}
      {packages.length ? packages.map((p) => {
        const steps = p.steps as StepDef[];
        return (
          <section key={p.id} className="card">
            <div className="payworkerhead">
              <div><b>{p.name}</b><span className="muted">{p.description ?? ''}</span></div>
              {admin && <PackageEditor credentialTypes={CREDENTIAL_TYPE_NAMES} pkg={{ id: p.id, name: p.name, description: p.description, steps }} />}
            </div>
            <ol className="muted" style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 14 }}>
              {steps.map((s, i) => <li key={i}>{s.label}{!s.required && ' (optional)'}{s.kind === 'STAFF' ? ' — staff' : s.kind === 'CREDENTIAL' ? ` — needs a verified ${s.credentialType}` : ''}</li>)}
            </ol>
          </section>
        );
      }) : <div className="card empty"><b>No packages yet</b>{admin ? 'Add a starter package above and adjust it, or build your own.' : 'Ask an admin to set up onboarding packages.'}</div>}
    </>
  );
}
