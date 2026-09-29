import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { credentialJson, lookupNpi } from '@/lib/credentials-server';

/**
 * Checks an NPI against the NPPES registry. When it's active and registered to someone with the candidate's
 * last name, the credential is marked verified; otherwise the recruiter sees what the registry says.
 */
export const POST = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const c = await tdb.credential.findFirst({ where: { id: params.id }, include: { candidate: { select: { name: true } } } });
  if (!c) throw new HttpError(404, 'That credential was deleted.');
  if (c.type !== 'NPI' || !c.number) throw new HttpError(400, 'Enter the 10-digit NPI first.');
  const r = await lookupNpi(c.number, c.candidate.name);
  if (!r.found) return Response.json({ verified: false, message: `No provider is registered with NPI ${c.number}.` });
  const summary = [r.registered, r.taxonomy, r.licenseState && r.license ? `license ${r.licenseState} ${r.license}` : null].filter(Boolean).join(' · ');
  if (!r.active) return Response.json({ verified: false, message: `The registry lists NPI ${c.number} as deactivated (${summary}).` });
  if (!r.individual || !r.nameMatches) return Response.json({ verified: false, message: `NPI ${c.number} is registered to ${summary}, which doesn’t match ${c.candidate.name}. Check the number with the candidate.` });
  await tdb.credential.updateMany({ where: { id: c.id }, data: { verifiedAt: new Date(), verifiedById: user.id, verifyMethod: 'NPPES NPI registry', verifyNote: `Active: ${summary}`.slice(0, 500) } });
  await logActivity(org.id, `Verified NPI for ${c.candidate.name} with the NPPES registry`, user.id);
  return Response.json({ verified: true, message: `Verified: ${summary}.`, credential: credentialJson((await tdb.credential.findFirst({ where: { id: c.id } }))!, user.name || user.email) });
});
