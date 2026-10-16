import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { newToken, sha256 } from '@/lib/tokens';
import { sendEmail } from '@/lib/email';
import { hasBlanks } from '@/lib/merge';
import { requestDocs } from '@/lib/hiring-docs-server';

/**
 * Lock the text, issue a one-time signing link (14 days) and email it to the signer. For a candidate, `requestDocs` (kinds
 * from HIRING_DOCS) asks for hiring documents with it: after signing they're taken to their page to send them.
 */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'esign', write: true });
  const doc = await tdb.signDocument.findFirst({ where: { id: params.id } });
  if (!doc) throw new HttpError(404, 'Not found');
  if (!['DRAFT', 'SENT'].includes(doc.status)) throw new HttpError(409, 'This document is already signed or void');
  if (!doc.signerEmail) throw new HttpError(400, 'Add the signer’s email first');
  if (hasBlanks(doc.body)) throw new HttpError(400, 'Fill in the blanks shown in [brackets] or {{braces}} before sending');

  const body = await req.json().catch(() => ({}));
  const docKinds: string[] = Array.isArray(body?.requestDocs) ? body.requestDocs.filter((k: unknown) => typeof k === 'string') : [];
  if (docKinds.length && doc.relatedType !== 'candidate') throw new HttpError(400, 'Documents can only be asked for from candidates.');

  const token = newToken();
  const audit = [...(doc.audit as object[]), { at: new Date().toISOString(), event: 'sent', to: doc.signerEmail, by: user.email }];
  await tdb.signDocument.updateMany({ where: { id: doc.id }, data: { status: 'SENT', tokenHash: sha256(token), tokenExpiresAt: new Date(Date.now() + 14 * 864e5), bodySha256: sha256(doc.body), audit } });
  const asked = docKinds.length ? await requestDocs(tdb, org, user, doc.relatedId, { kinds: docKinds }, { signDocumentId: doc.id }) : null;
  const link = `${process.env.APP_URL}/sign/${token}`;
  try {
    await sendEmail({
      to: doc.signerEmail, replyTo: user.email, fromName: org.shortName ?? org.name,
      subject: `Please sign: ${doc.title}`,
      text: `Hi ${doc.signerName.split(' ')[0]},\n\n${org.name} has sent you "${doc.title}" to review and sign electronically.\n\nOpen and sign: ${link}\n\n${asked ? 'After you sign, you’ll be asked to upload a few hiring documents (such as your tax and direct deposit forms) securely. Please don’t send them by email.\n\n' : ''}This link is personal to you and expires in 14 days.\n\n${user.name ?? ''}\n${org.name}`,
    });
  } catch (e) {
    // Nobody received the link, so put the document back the way it was.
    await tdb.signDocument.updateMany({ where: { id: doc.id }, data: { status: doc.status, tokenHash: doc.tokenHash, tokenExpiresAt: doc.tokenExpiresAt, bodySha256: doc.bodySha256, audit: doc.audit as object[] } });
    console.error('[esign] email failed', e);
    throw new HttpError(502, 'The signing email couldn’t be sent. Check the signer’s email address and try again.');
  }
  await logActivity(org.id, `Sent ${doc.title} for signature`, user.id);
  return Response.json({ ok: true, requested: asked?.requested ?? 0 });
});
