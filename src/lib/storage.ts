import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { db } from './db';

// STORAGE_DRIVER=local keeps files on disk under .data/uploads for development without S3. Production uses S3 (the default).
const LOCAL = process.env.STORAGE_DRIVER === 'local';
const LOCAL_ROOT = path.join(process.cwd(), '.data', 'uploads');

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' },
});

const ALLOWED = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'text/plain', 'text/vtt']);

const localPath = (key: string) => {
  const p = path.join(LOCAL_ROOT, key);
  if (!p.startsWith(LOCAL_ROOT + path.sep)) throw new Error('Invalid file key');
  return p;
};

export async function putFile(orgId: string, filename: string, contentType: string, body: Buffer) {
  if (!ALLOWED.has(contentType)) throw new Error('Unsupported file type');
  if (body.length > 10 * 1024 * 1024) throw new Error('File is larger than 10 MB');
  const key = `${orgId}/${randomUUID()}-${filename.replace(/[^\w.\-]/g, '_').slice(-80)}`;
  if (LOCAL) { await mkdir(path.dirname(localPath(key)), { recursive: true }); await writeFile(localPath(key), body); }
  else await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  return db.storedFile.create({ data: { organizationId: orgId, key, filename, contentType, size: body.length } });
}

/** Short-lived download link. Caller must have already verified the file belongs to their org. S3 only. */
export async function fileUrl(key: string, seconds = 300) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn: seconds });
}

/** A file's bytes. Caller must have already verified the file belongs to their org. */
export async function getFile(key: string): Promise<Buffer> {
  if (LOCAL) return readFile(localPath(key));
  const res = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

/** Removes a file's bytes from storage (the StoredFile row is the caller's to delete). Missing files are fine. */
export async function removeFile(key: string) {
  if (LOCAL) { await rm(localPath(key), { force: true }); return; }
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

// ---- large files (training videos): the browser uploads straight to storage, so they never pass through the app server ----

export const isLocalStorage = () => LOCAL;

/** What's missing for uploads to work (setting names only). Empty when storage is ready. */
export function storageMissing() {
  if (LOCAL) return [];
  return ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !process.env[k]);
}

/** A new object key for an upload, always inside the org's own folder. */
export const newKey = (orgId: string, folder: string, filename: string) => `${orgId}/${folder}/${randomUUID()}-${filename.replace(/[^\w.\-]/g, '_').slice(-80)}`;

/**
 * Where the browser sends the file. S3: a presigned PUT (valid one hour) that must carry the same Content-Type.
 * Local development: an app route that writes to disk.
 */
export async function uploadUrl(key: string, contentType: string) {
  if (LOCAL) return `/api/training/media/upload?key=${encodeURIComponent(key)}`;
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType }), { expiresIn: 3600 });
}

/** Size and type of an uploaded object, or null if it isn't there. */
export async function headFile(key: string): Promise<{ size: number; contentType: string | null } | null> {
  try {
    if (LOCAL) return { size: (await stat(localPath(key))).size, contentType: null };
    const h = await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return { size: h.ContentLength ?? 0, contentType: h.ContentType ?? null };
  } catch { return null; }
}

/** Development only: writes an upload to disk. */
export async function writeLocal(key: string, body: Buffer) {
  await mkdir(path.dirname(localPath(key)), { recursive: true });
  await writeFile(localPath(key), body);
}

/** Records an uploaded object as the org's file. */
export const recordFile = (orgId: string, key: string, filename: string, contentType: string, size: number) =>
  db.storedFile.create({ data: { organizationId: orgId, key, filename, contentType, size } });

/** For playback: S3 gives a presigned link (video players fetch ranges from it directly); local streams from disk. */
export async function playbackUrl(key: string) { return LOCAL ? null : fileUrl(key, 6 * 3600); }

/** Bytes for a Range request, from the local disk (development). */
export async function localRange(key: string, range: string | null, contentType: string) {
  const buf = await readFile(localPath(key));
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m || (!m[1] && !m[2])) return new Response(new Uint8Array(buf), { headers: { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Length': String(buf.length), 'Cache-Control': 'private, no-store' } });
  const start = m[1] ? Number(m[1]) : Math.max(0, buf.length - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
  if (start >= buf.length || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${buf.length}` } });
  return new Response(new Uint8Array(buf.subarray(start, end + 1)), { status: 206, headers: { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': String(end - start + 1), 'Cache-Control': 'private, no-store' } });
}
