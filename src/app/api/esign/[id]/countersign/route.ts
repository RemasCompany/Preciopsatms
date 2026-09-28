import { z } from 'zod';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { renderSignedPdf } from '@/lib/pdf';
import { putFile } from '@/lib/storage';
import { sendEmail } from '@/lib/email';
import { sha256 } from '@/lib/tokens';
import type { AuditEntry } from '@/lib/esign';

const Body = z.object({
  name: z.string().trim().min(2).max(120),
  signature: z.string().startsWith('data:image/png;base64,').max(300_000),
  consent: z.literal(true),
});

/** Countersign a signed document for the company. Regenerates the PDF with both signatures and emails the signer a copy. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'esign', write: true });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, 'Type your full name, draw your signature and check the consent box.');
  const doc = await tdb.signDocument.findFirst({ where: { id: params.id } });
  if (!doc) throw new HttpError(404, 'That document was deleted.');
  if (doc.status !== 'SIGNED') throw new HttpError(409, doc.status === 'COUNTERSIGNED' ? 'This document is already countersigned.' : 'The signer has to sign before you can countersign.');
  if (doc.bodySha256 && doc.bodySha256 !== sha256(doc.body)) throw new HttpError(409, 'The document text no longer matches what was signed.');

  const at = new Date();
  const audit = [...((doc.audit as AuditEntry[]) ?? []), { at: at.toISOString(), event: 'countersigned', name: parsed.data.name, by: user.email, consent: 'Agreed to use electronic records and signatures (ESIGN/UETA)' }];
  const signed = { ...doc, counterName: parsed.data.name, counterSignature: parsed.data.signature, counterSignedAt: at, audit, organization: { name: org.name } };
  const pdf = Buffer.from(await renderSignedPdf(signed));
  const file = await putFile(org.id, `${doc.title} (countersigned).pdf`, 'application/pdf', pdf);
  const { count } = await tdb.signDocument.updateMany({
    where: { id: doc.id, status: 'SIGNED' },
    data: { status: 'COUNTERSIGNED', counterName: parsed.data.name, counterSignature: parsed.data.signature, counterSignedAt: at, audit, pdfFileId: file.id },
  });
  if (!count) throw new HttpError(409, 'This document is already countersigned.');
  await logActivity(org.id, `${parsed.data.name} countersigned ${doc.title}`, user.id);
  await sendEmail({ to: doc.signerEmail, fromName: org.shortName ?? org.name, replyTo: user.email, subject: `Fully signed: ${doc.title}`, text: `"${doc.title}" is now signed by both parties. Your copy is attached.\n\n${org.name}`, attachments: [{ filename: `${doc.title}.pdf`, content: pdf }] })
    .catch((e) => console.error('[esign] countersigned copy email failed', e)); // already countersigned; don't fail the request
  return Response.json({ ok: true });
});
