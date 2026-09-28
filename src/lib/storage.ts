import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { db } from './db';

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' },
});

const ALLOWED = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'text/plain']);

export async function putFile(orgId: string, filename: string, contentType: string, body: Buffer) {
  if (!ALLOWED.has(contentType)) throw new Error('Unsupported file type');
  if (body.length > 10 * 1024 * 1024) throw new Error('File is larger than 10 MB');
  const key = `${orgId}/${randomUUID()}-${filename.replace(/[^\w.\-]/g, '_').slice(-80)}`;
  await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  return db.storedFile.create({ data: { organizationId: orgId, key, filename, contentType, size: body.length } });
}

/** Short-lived download link. Caller must have already verified the file belongs to their org. */
export async function fileUrl(key: string, seconds = 300) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn: seconds });
}
