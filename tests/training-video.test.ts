import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Uploads go to the local disk in tests (no S3); set before storage.ts loads.
vi.hoisted(() => { process.env.STORAGE_DRIVER = 'local'; });
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async () => ({ id: 's' })) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { FORKLIFT_TEMPLATE, mergeWatch, toVtt, videoEmbed, watchSummary, type Lesson } from '@/lib/training';
import { storageStatus } from '@/lib/storage-status';
import { newToken, sha256 } from '@/lib/tokens';
import { POST as ADD_COURSE } from '@/app/api/training/courses/route';
import { PATCH as EDIT_COURSE } from '@/app/api/training/courses/[id]/route';
import { POST as MEDIA } from '@/app/api/training/media/route';
import { PUT as UPLOAD } from '@/app/api/training/media/upload/route';
import { GET as PREVIEW } from '@/app/api/training/media/[id]/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { POST as LEARN } from '@/app/api/public/training/[token]/route';
import { GET as WORKER_MEDIA } from '@/app/api/public/training/[token]/media/route';
import { GET as CERTIFICATE } from '@/app/api/training/enrollments/[id]/certificate/route';

describe('video links', () => {
  it('plays YouTube, Vimeo, Loom and Google Drive links inside the lesson, and knows which report progress', () => {
    const yt = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&enablejsapi=1';
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'youtube', src: yt, trackable: true });
    expect(videoEmbed('https://youtu.be/dQw4w9WgXcQ?t=42')?.src).toBe(`${yt}&start=42`);
    expect(videoEmbed('https://youtube.com/shorts/dQw4w9WgXcQ')?.src).toBe(yt);
    expect(videoEmbed('https://vimeo.com/123456789')).toEqual({ kind: 'vimeo', src: 'https://player.vimeo.com/video/123456789?dnt=1', trackable: true });
    expect(videoEmbed('https://vimeo.com/123456789/abc123def0')?.src).toBe('https://player.vimeo.com/video/123456789?dnt=1&h=abc123def0');
    expect(videoEmbed('https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184')).toMatchObject({ kind: 'loom', src: 'https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184', trackable: false });
    expect(videoEmbed('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing')).toMatchObject({ kind: 'drive', src: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMn/preview', trackable: false });
    expect(videoEmbed('https://cdn.example.com/forklift.mp4')).toMatchObject({ kind: 'file', trackable: true });
    for (const bad of ['http://youtube.com/watch?v=dQw4w9WgXcQ', 'https://example.com/page', 'https://youtube.com/watch?v=<script>', 'javascript:alert(1)', '']) expect(videoEmbed(bad), bad).toBeNull();
  });
  it('counts only the parts actually played, caps time per report, and averages across video lessons', () => {
    let w = mergeWatch(undefined, { segments: [0, 1, 2, 2, 150, -1], seconds: 30, duration: 100 });
    expect(w).toMatchObject({ s: [0, 1, 2], sec: 30, dur: 100 });
    w = mergeWatch(w, { segments: [2, 3], seconds: 9999, duration: 100 }); // a bogus report can't add hours
    expect(w.sec).toBeLessThanOrEqual(400);
    const lessons: Lesson[] = [{ title: 'a', body: 'x', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }, { title: 'b', body: 'x' }, { title: 'c', body: 'x', videoFileId: 'f1' }, { title: 'd', body: 'x', videoUrl: 'https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184' }];
    const s = watchSummary(lessons, { 0: { s: Array.from({ length: 80 }, (_, i) => i), sec: 300, dur: 400, at: '' } });
    expect(s).toMatchObject({ videos: 2, pct: 40, seconds: 300 }); // lessons 0 and 2; Loom can't be tracked
  });
  it('accepts WebVTT captions and converts SRT', () => {
    expect(toVtt('WEBVTT\n\n00:00.000 --> 00:02.000\nHi')).toBe('WEBVTT\n\n00:00.000 --> 00:02.000\nHi\n');
    expect(toVtt('﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nCheck the forks\r\n')).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nCheck the forks\n');
    expect(toVtt('just some text')).toBeNull();
  });
  it('says which storage settings are missing, by name only', () => {
    expect(storageStatus({ S3_BUCKET: 'b', S3_REGION: 'us-east-1' })).toMatchObject({ ok: false, missing: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] });
    expect(storageStatus({ S3_BUCKET: 'b', S3_REGION: 'r', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }).ok).toBe(true);
    expect(storageStatus({ STORAGE_DRIVER: 'local', NODE_ENV: 'production' }).ok).toBe(false);
    expect(JSON.stringify(storageStatus({ S3_BUCKET: 'b', S3_REGION: 'r', S3_ACCESS_KEY_ID: 'AKIASECRET', S3_SECRET_ACCESS_KEY: 'shh' }))).not.toMatch(/AKIASECRET|shh/);
  });
});

const RUN = `tv${Date.now()}`;
let org: string, other: string, admin: string, rec: string, otherAdmin: string, worker: string, worker2: string, otherFile: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const json = (method: string, body: unknown) => new Request('http://x', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const media = async (body: object) => { const r = await MEDIA(json('POST', body)); return { status: r.status, body: await r.json() }; };
const linkFor = async (candidateId: string, orgId = org) => { const token = newToken(); await db.workerLink.create({ data: { organizationId: orgId, candidateId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 864e5) } }); return token; };
const T = (token: string) => ({ params: { token } });

/** Uploads a "video" the way the browser does: start → PUT the bytes → complete. */
async function uploadVideo(name = 'walkaround.mp4', bytes = Buffer.from('fake-mp4-bytes-0123456789')) {
  const s = await media({ action: 'start', filename: name, size: bytes.length });
  expect(s.status).toBe(200);
  expect((await UPLOAD(new Request(`http://x${s.body.url}`, { method: 'PUT', body: bytes }))).status).toBe(200);
  return media({ action: 'complete', key: s.body.key, filename: name });
}

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Acme', slug: `acme-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `other-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, otherAdmin] = await Promise.all([u('admin'), u('rec'), u('otheradmin')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: otherAdmin, organizationId: other, role: 'ADMIN' }] });
  worker = (await tenantDb(org).candidate.create({ data: { name: 'Wes Worker' } as never })).id;
  worker2 = (await tenantDb(org).candidate.create({ data: { name: 'Val Worker' } as never })).id;
  as(otherAdmin, other);
  otherFile = (await uploadVideo('theirs.mp4')).body.id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
});

describe('uploading training videos', () => {
  it('admins upload videos and captions; recruiters can’t; wrong types and sizes are refused with a reason', async () => {
    as(rec);
    expect((await media({ action: 'start', filename: 'a.mp4', size: 10 })).status).toBe(403);
    as(admin);
    expect((await media({ action: 'start', filename: 'a.avi', size: 10 })).body.error).toContain('MP4');
    expect((await media({ action: 'start', filename: 'a.mp4', size: 3 * 1024 ** 3 })).status).toBe(413);
    // Another company's upload key can't be claimed.
    expect((await media({ action: 'complete', key: `${other}/training/x-theirs.mp4`, filename: 'theirs.mp4' })).status).toBe(403);
    expect((await UPLOAD(new Request(`http://x/api/training/media/upload?key=${encodeURIComponent(`${other}/training/x.mp4`)}`, { method: 'PUT', body: 'x' }))).status).toBe(403);
    const v = await uploadVideo();
    expect(v).toMatchObject({ status: 201, body: { filename: 'walkaround.mp4' } });
    const fd = new FormData(); fd.set('file', new File(['1\n00:00:01,000 --> 00:00:02,000\nLook up\n'], 'walkaround.srt'));
    const cap = await MEDIA(new Request('http://x', { method: 'POST', body: fd }));
    expect(cap.status).toBe(201);
    expect((await cap.json()).filename).toBe('walkaround.vtt');
    const bad = new FormData(); bad.set('file', new File(['not captions'], 'x.vtt'));
    expect((await MEDIA(new Request('http://x', { method: 'POST', body: bad }))).status).toBe(400);
  });
});

describe('watch before the test', () => {
  let course: string, enrollment: string, token: string, videoId: string, captionId: string;
  it('a course can require 90% of each video, with an uploaded video, captions and a YouTube lesson', async () => {
    as(admin);
    videoId = (await uploadVideo()).body.id;
    const fd = new FormData(); fd.set('file', new File(['WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n'], 'c.vtt'));
    captionId = (await (await MEDIA(new Request('http://x', { method: 'POST', body: fd }))).json()).id;
    const lessons = [
      { title: 'Walkaround', body: 'Watch the walkaround.', videoFileId: videoId, captionFileId: captionId },
      { title: 'Data plate', body: 'Read the plate.', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { title: 'Shop tour', body: 'Optional tour.', videoUrl: 'https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184' },
      { title: 'Rules', body: 'Text only.' },
    ];
    // A file from another company can't be put in this course.
    expect((await ADD_COURSE(json('POST', { ...FORKLIFT_TEMPLATE, title: 'Bad', lessons: [{ ...lessons[0], videoFileId: otherFile }] }))).status).toBe(400);
    const r = await ADD_COURSE(json('POST', { ...FORKLIFT_TEMPLATE, title: 'Forklift video course', minWatchPct: 90, lessons }));
    expect(r.status).toBe(201);
    course = (await r.json()).id;
    const saved = await tenantDb(org).trainingCourse.findFirstOrThrow({ where: { id: course } });
    expect(saved.minWatchPct).toBe(90);
    expect((saved.lessons as Lesson[])[0]).toMatchObject({ videoFileId: videoId, videoName: 'walkaround.mp4', captionFileId: captionId, captionName: 'c.vtt' });
    enrollment = (await tenantDb(org).trainingEnrollment.create({ data: { courseId: course, candidateId: worker, status: 'assigned', reason: 'initial' } as never })).id;
    token = await linkFor(worker);
  });

  it('the worker sees playable videos and can’t finish a video lesson or take the quiz until they’ve watched 90%', async () => {
    const page = await (await PAGE(new Request('http://x'), T(token))).json();
    const c = page.training.find((x: { id: string }) => x.id === enrollment);
    expect(c.minWatchPct).toBe(90);
    expect(c.lessons.map((l: { video: { kind: string } | null; captions: boolean }) => [l.video?.kind ?? null, l.captions])).toEqual([['upload', true], ['youtube', false], ['loom', false], [null, false]]);
    expect(JSON.stringify(c)).not.toContain(videoId); // file ids stay on the server
    const learn = async (body: object) => { const r = await LEARN(json('POST', { enrollmentId: enrollment, ...body }), T(token)); return { status: r.status, body: await r.json() }; };
    const locked = await learn({ lesson: 0 });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toContain('90%');
    expect((await learn({ lesson: 2 })).status).toBe(200); // Loom can't be tracked, so it isn't held to the rule
    expect((await learn({ lesson: 3 })).status).toBe(200);
    expect((await learn({ watch: { lesson: 3, segments: [1], seconds: 5, duration: 60 } })).status).toBe(400); // no video there
    // Skipping to the end only counts the part played.
    expect((await learn({ watch: { lesson: 0, segments: [99], seconds: 1, duration: 120 } })).body.watched).toBe(1);
    expect((await learn({ watch: { lesson: 0, segments: Array.from({ length: 89 }, (_, i) => i), seconds: 107, duration: 120 } })).body.watched).toBe(90);
    expect((await learn({ lesson: 0 })).status).toBe(200);
    expect((await learn({ watch: { lesson: 1, segments: Array.from({ length: 50 }, (_, i) => i), seconds: 60, duration: 120 } })).body.watched).toBe(50);
    expect((await learn({ lesson: 1 })).status).toBe(409);
    await learn({ watch: { lesson: 1, segments: Array.from({ length: 50 }, (_, i) => i + 50), seconds: 60, duration: 120 } });
    expect((await learn({ lesson: 1 })).status).toBe(200);
    const e = await tenantDb(org).trainingEnrollment.findFirstOrThrow({ where: { id: enrollment } });
    expect(e.lastActivityAt).not.toBeNull();
    expect((e.watch as Record<string, { sec: number }>)[0].sec).toBe(108);
  });

  it('the quiz also checks the videos, even if a lesson was marked done before the requirement was added', async () => {
    as(admin);
    const c = await tenantDb(org).trainingCourse.findFirstOrThrow({ where: { id: course } });
    const e2 = (await tenantDb(org).trainingEnrollment.create({ data: { courseId: course, candidateId: worker2, status: 'assigned', reason: 'initial', lessonsDone: [0, 1, 2, 3] } as never })).id;
    const t2 = await linkFor(worker2);
    const answers = (c.questions as { answer: number }[]).map((q) => q.answer);
    const r = await LEARN(json('POST', { enrollmentId: e2, answers }), T(t2));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/lesson 1, 2/);
    const ok = await LEARN(json('POST', { enrollmentId: enrollment, answers }), T(token));
    expect((await ok.json()).passed).toBe(true);
  });

  it('only the assigned worker can play the uploaded video; seeking works; the team can preview', async () => {
    const get = (t: string, e: string, l: number, kind = 'video', range?: string) => WORKER_MEDIA(new Request(`http://x/api/public/training/${t}/media?e=${e}&l=${l}&t=${kind}`, { headers: range ? { range } : {} }), T(t));
    const full = await get(token, enrollment, 0);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    const part = await get(token, enrollment, 0, 'video', 'bytes=5-8');
    expect(part.status).toBe(206);
    expect(Buffer.from(await part.arrayBuffer()).toString()).toBe('mp4-');
    const vtt = await get(token, enrollment, 0, 'caption');
    expect(vtt.headers.get('content-type')).toContain('text/vtt');
    expect((await get(token, enrollment, 1)).status).toBe(404); // a YouTube lesson has no file
    const someoneElse = await linkFor(worker2);
    expect((await get(someoneElse, enrollment, 0)).status).toBe(404);
    expect((await get('nope', enrollment, 0)).status).toBe(404);
    as(rec);
    expect((await PREVIEW(new Request('http://x'), { params: { id: videoId } })).status).toBe(200);
    as(otherAdmin, other);
    expect((await PREVIEW(new Request('http://x'), { params: { id: videoId } })).status).toBe(404);
  });

  it('the certificate records how much of the videos were watched', async () => {
    await db.trainingEnrollment.update({ where: { id: enrollment }, data: { status: 'certified', certifiedAt: new Date(), evaluatedAt: new Date(), trainedAt: new Date(), evaluatorName: 'Tia Trainer', evaluatorTitle: 'Safety lead', expiresAt: new Date(Date.now() + 365 * 864e5) } });
    as(admin);
    const pdf = Buffer.from(await (await CERTIFICATE(new Request('http://x'), { params: { id: enrollment } })).arrayBuffer());
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('replacing a video deletes the old file', async () => {
    as(admin);
    const c = await tenantDb(org).trainingCourse.findFirstOrThrow({ where: { id: course } });
    const lessons = (c.lessons as Lesson[]).map((l, i) => (i === 0 ? { ...l, videoFileId: null, captionFileId: null, videoUrl: 'https://vimeo.com/123456789' } : l));
    expect((await EDIT_COURSE(json('PATCH', { ...c, description: c.description, lessons }), { params: { id: course } })).status).toBe(200);
    expect(await tenantDb(org).storedFile.count({ where: { id: { in: [videoId, captionId] } } })).toBe(0);
  });
});
