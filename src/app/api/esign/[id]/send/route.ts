import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { newToken, sha256 } from '@/lib/tokens';
import { sendEmail } from '@/lib/email';

/** Lock the text, issue a one-time signing link (14 days) and email it to the signer. */
export const POST = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'esign', write: true });
  const doc = await tdb.signDocument.findFirst({ where: { id: params.id } });
  if (!doc) throw new HttpError(404, 'Not found');
  if (!['DRAFT', 'SENT'].includes(doc.status)) throw new HttpError(409, 'This document is already signed or void');
  if (!doc.signerEmail) throw new HttpError(400, 'Add the signer’s email first');
  if (/\[[a-z %]+\]/i.test(doc.body)) throw new HttpError(400, 'Fill in the blanks shown in [brackets] before sending');

  const token = newToken();
  const audit = [...(doc.audit as object[]), { at: new Date().toISOString(), event: 'sent', to: doc.signerEmail, by: user.email }];
  await tdb.signDocument.updateMany({ where: { id: doc.id }, data: { status: 'SENT', tokenHash: sha256(token), tokenExpiresAt: new Date(Date.now() + 14 * 864e5), bodySha256: sha256(doc.body), audit } });
  const link = `${process.env.APP_URL}/sign/${token}`;
  await sendEmail({
    to: doc.signerEmail, replyTo: user.email, fromName: org.shortName ?? org.name,
    subject: `Please sign: ${doc.title}`,
    text: `Hi ${doc.signerName.split(' ')[0]},\n\n${org.name} has sent you "${doc.title}" to review and sign electronically.\n\nOpen and sign: ${link}\n\nThis link is personal to you and expires in 14 days.\n\n${user.name ?? ''}\n${org.name}`,
  });
  await logActivity(org.id, `Sent ${doc.title} for signature`, user.id);
  return Response.json({ ok: true });
});
