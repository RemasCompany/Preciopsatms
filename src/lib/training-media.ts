import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { getFile, headFile, localRange, newKey, playbackUrl, putFile, recordFile, removeFile, storageMissing, uploadUrl } from './storage';
import { MAX_CAPTION_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES, toVtt, type Lesson } from './training';

/**
 * Training videos and captions. Videos go straight from the admin's browser to private storage (a presigned upload), so
 * size isn't limited by the app server; the app then checks what arrived and records it. Workers only ever reach a video
 * through their own enrollment, from their private link.
 */
const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const gb = (n: number) => `${Math.round(n / 1024 ** 3)} GB`;

const Start = z.object({ action: z.literal('start'), filename: z.string().trim().min(1).max(200), size: z.number().int().positive() });
const Complete = z.object({ action: z.literal('complete'), key: z.string().min(1).max(300), filename: z.string().trim().min(1).max(200) });

export async function startUpload(org: Organization, raw: unknown) {
  const p = Start.safeParse(raw);
  if (!p.success) throw new HttpError(400, 'Choose a video file.');
  const type = VIDEO_TYPES[ext(p.data.filename)];
  if (!type) throw new HttpError(415, 'Upload an MP4, MOV or WebM video. MP4 plays on every phone.');
  if (p.data.size > MAX_VIDEO_BYTES) throw new HttpError(413, `That video is larger than ${gb(MAX_VIDEO_BYTES)}. Export it at 1080p or lower, or link it from YouTube or Vimeo.`);
  const missing = storageMissing();
  if (missing.length) throw new HttpError(503, 'Video uploads aren’t set up on this site yet (file storage settings are missing). Use a YouTube or Vimeo link for now, or ask your Preciops administrator.');
  const key = newKey(org.id, 'training', p.data.filename);
  return { key, url: await uploadUrl(key, type), contentType: type };
}

export async function completeUpload(org: Organization, user: User, raw: unknown) {
  const p = Complete.safeParse(raw);
  if (!p.success) throw new HttpError(400, 'Invalid input');
  if (!p.data.key.startsWith(`${org.id}/training/`) || p.data.key.includes('..')) throw new HttpError(403, 'That upload isn’t yours.');
  const type = VIDEO_TYPES[ext(p.data.filename)];
  if (!type) throw new HttpError(415, 'Upload an MP4, MOV or WebM video.');
  const head = await headFile(p.data.key);
  if (!head || !head.size) throw new HttpError(400, 'The upload didn’t finish. Try again.');
  if (head.size > MAX_VIDEO_BYTES || (head.contentType && head.contentType !== type)) {
    await removeFile(p.data.key);
    throw new HttpError(head.size > MAX_VIDEO_BYTES ? 413 : 415, head.size > MAX_VIDEO_BYTES ? `That video is larger than ${gb(MAX_VIDEO_BYTES)}.` : 'That file isn’t the video type it said it was.');
  }
  const f = await recordFile(org.id, p.data.key, p.data.filename, type, head.size);
  await logActivity(org.id, `Uploaded the training video “${p.data.filename}”`, user.id);
  return { id: f.id, filename: f.filename, size: f.size };
}

/** Captions: a .vtt file, or .srt (converted to WebVTT, which browsers show). */
export async function uploadCaption(org: Organization, file: File) {
  if (!file.size) throw new HttpError(400, 'Choose a captions file.');
  if (file.size > MAX_CAPTION_BYTES) throw new HttpError(413, 'Captions files are small text files; that one is over 1 MB.');
  if (!['vtt', 'srt'].includes(ext(file.name))) throw new HttpError(415, 'Upload captions as a .vtt or .srt file.');
  const vtt = toVtt(await file.text());
  if (!vtt) throw new HttpError(400, 'That file isn’t in WebVTT or SRT format.');
  const name = file.name.replace(/\.srt$/i, '.vtt');
  const f = await putFile(org.id, name, 'text/vtt', Buffer.from(vtt, 'utf8'));
  return { id: f.id, filename: f.filename, size: f.size };
}

/** Checks the files a course's lessons point to belong to this org and are the right kind, and fills in their names. */
export async function resolveLessonFiles(tdb: TenantDb, lessons: Lesson[]): Promise<Lesson[]> {
  const ids = lessons.flatMap((l) => [l.videoFileId, l.captionFileId]).filter((x): x is string => !!x);
  const files = ids.length ? await tdb.storedFile.findMany({ where: { id: { in: ids } }, select: { id: true, filename: true, contentType: true } }) : [];
  const by = new Map(files.map((f) => [f.id, f]));
  return lessons.map((l, i) => {
    const v = l.videoFileId ? by.get(l.videoFileId) : null, c = l.captionFileId ? by.get(l.captionFileId) : null;
    if (l.videoFileId && !v?.contentType.startsWith('video/')) throw new HttpError(400, `Lesson ${i + 1}’s video is missing. Upload it again.`);
    if (l.captionFileId && c?.contentType !== 'text/vtt') throw new HttpError(400, `Lesson ${i + 1}’s captions file is missing. Upload it again.`);
    return { ...l, videoFileId: v?.id ?? null, videoName: v?.filename ?? null, captionFileId: c?.id ?? null, captionName: c?.filename ?? null };
  });
}

/** Deletes uploaded files a course no longer uses (replaced or removed), unless another course still uses them. */
export async function dropUnusedFiles(tdb: TenantDb, before: Lesson[], after: Lesson[]) {
  const ids = (ls: Lesson[]) => new Set(ls.flatMap((l) => [l.videoFileId, l.captionFileId]).filter((x): x is string => !!x));
  const keep = ids(after);
  const gone = [...ids(before)].filter((id) => !keep.has(id));
  if (!gone.length) return;
  const others = await tdb.trainingCourse.findMany({ select: { lessons: true } });
  const used = new Set(others.flatMap((c) => [...ids(c.lessons as Lesson[])]));
  for (const id of gone.filter((x) => !used.has(x))) {
    const f = await tdb.storedFile.findFirst({ where: { id } });
    if (!f) continue;
    await removeFile(f.key).catch(() => undefined);
    await tdb.storedFile.deleteMany({ where: { id } });
  }
}

/** Sends a stored video (a presigned redirect, or Range-aware bytes in development) or captions (always from the app, so the player can read them). */
export async function serveMedia(file: { key: string; contentType: string }, range: string | null) {
  if (file.contentType === 'text/vtt') return new Response(new Uint8Array(await getFile(file.key)), { headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
  if (!file.contentType.startsWith('video/')) throw new HttpError(404, 'That video isn’t available.');
  const url = await playbackUrl(file.key);
  if (url) return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'private, no-store' } });
  return localRange(file.key, range, file.contentType);
}

/** A worker's video or captions for one lesson of their own training. */
export async function workerMedia(link: { organizationId: string; candidateId: string }, enrollmentId: string, lesson: number, kind: 'video' | 'caption', range: string | null) {
  const tdb = tenantDb(link.organizationId);
  const e = await tdb.trainingEnrollment.findFirst({ where: { id: enrollmentId, candidateId: link.candidateId, status: { in: ['assigned', 'evaluation', 'certified'] } }, include: { course: { select: { lessons: true } } } });
  const l = (e?.course.lessons as Lesson[] | undefined)?.[lesson];
  const id = kind === 'video' ? l?.videoFileId : l?.captionFileId;
  const file = id ? await tdb.storedFile.findFirst({ where: { id } }) : null;
  if (!file) throw new HttpError(404, 'That video isn’t available. Ask your recruiter for a new link.');
  return serveMedia(file, range);
}
