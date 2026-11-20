'use client';
import { useState } from 'react';
import LessonVideo from './LessonVideo';
import { VIDEO_LABEL, lessonVideo, videoEmbed, type Lesson } from '@/lib/training';
import { suggestionsFor } from '@/lib/training-videos';

/** One lesson's video in the course editor: a link (YouTube, Vimeo, Loom, Google Drive, a video file) or an upload, plus captions. */
export default function CourseVideoField({ lesson, index, watchRequired, certType, onChange }: {
  lesson: Lesson; index: number; watchRequired: boolean; certType: string; onChange: (patch: Partial<Lesson>) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [busyCaption, setBusyCaption] = useState(false);
  const [preview, setPreview] = useState(false);
  const link = lesson.videoUrl ? videoEmbed(lesson.videoUrl) : null;
  const video = lessonVideo(lesson);

  async function upload(file: File) {
    setErr(''); setProgress(0);
    try {
      const start = await fetch('/api/training/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', filename: file.name, size: file.size }) });
      const s = await start.json().catch(() => ({}));
      if (!start.ok) throw new Error(s.error ?? 'The upload couldn’t start.');
      await new Promise<void>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('PUT', s.url);
        x.setRequestHeader('Content-Type', s.contentType);
        x.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`The upload was refused (${x.status}).`)));
        x.onerror = () => reject(new Error('The upload was blocked. If this keeps happening, your file storage needs to allow uploads from this site (CORS).'));
        x.send(file);
      });
      const done = await fetch('/api/training/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete', key: s.key, filename: file.name }) });
      const d = await done.json().catch(() => ({}));
      if (!done.ok) throw new Error(d.error ?? 'The upload didn’t finish.');
      onChange({ videoFileId: d.id, videoName: d.filename });
    } catch (e) { setErr((e as Error).message); } finally { setProgress(null); }
  }

  async function caption(file: File) {
    setErr(''); setBusyCaption(true);
    const fd = new FormData(); fd.set('file', file);
    const r = await fetch('/api/training/media', { method: 'POST', body: fd }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusyCaption(false);
    if (!r?.ok) { setErr(j.error ?? 'The captions didn’t upload.'); return; }
    onChange({ captionFileId: j.id, captionName: j.filename });
  }

  const captionsApply = video?.kind === 'upload' || video?.kind === 'file';
  return (
    <div className="subform" style={{ margin: '6px 0' }}>
      <b style={{ fontSize: 14 }}>Video (optional)</b>
      {lesson.videoFileId ? (
        <p style={{ margin: '4px 0' }}>Uploaded: <b>{lesson.videoName ?? 'video'}</b>{' '}
          <button type="button" className="btn ghost sm" onClick={() => setPreview(!preview)}>{preview ? 'Hide' : 'Preview'}</button>{' '}
          <button type="button" className="btn ghost sm" onClick={() => onChange({ videoFileId: null, videoName: null })}>Remove</button></p>
      ) : (
        <>
          <label>Link<input value={lesson.videoUrl ?? ''} placeholder="YouTube, Vimeo, Loom or Google Drive link" aria-label={`Lesson ${index + 1} video link`} onChange={(e) => onChange({ videoUrl: e.target.value })} /></label>
          {lesson.videoUrl && (link
            ? <p className="muted" style={{ margin: '2px 0' }}>{VIDEO_LABEL[link.kind]}: plays inside the lesson{link.trackable ? ', and we record how much was watched.' : '. It can’t report how much was watched, so the watch requirement doesn’t apply to it.'}
              {' '}<button type="button" className="linkish" onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Preview'}</button></p>
            : /^https:\/\//.test(lesson.videoUrl) ? <p className="muted" style={{ margin: '2px 0' }}>Workers get this as a link to open (it isn’t a video we can play inside the lesson).</p> : null)}
          {!lesson.videoUrl && (
            <label>…or upload a video (MP4, MOV or WebM, up to 2 GB)
              <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" disabled={progress !== null} aria-label={`Lesson ${index + 1} video file`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
            </label>
          )}
          {progress !== null && <p role="status">Uploading… {progress}%</p>}
          {!lesson.videoUrl && progress === null && <Suggestions certType={certType} lessonTitle={lesson.title} index={index} onUse={(url) => onChange({ videoUrl: url })} />}
        </>
      )}
      {preview && video && (video.kind !== 'upload' || lesson.videoFileId) && (
        <div style={{ margin: '6px 0' }}><LessonVideo video={video} title={lesson.title || `Lesson ${index + 1}`} src={video.kind === 'upload' ? `/api/training/media/${lesson.videoFileId}` : video.src} captions={captionsApply && lesson.captionFileId ? `/api/training/media/${lesson.captionFileId}` : null} /></div>
      )}
      {captionsApply && (
        lesson.captionFileId
          ? <p style={{ margin: '4px 0' }}>Captions: <b>{lesson.captionName ?? 'captions.vtt'}</b> <button type="button" className="btn ghost sm" onClick={() => onChange({ captionFileId: null, captionName: null })}>Remove</button></p>
          : <label>Captions (optional: a .vtt or .srt file)<input type="file" accept=".vtt,.srt,text/vtt" disabled={busyCaption} aria-label={`Lesson ${index + 1} captions file`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) caption(f); }} /></label>
      )}
      {video && !captionsApply && <p className="muted" style={{ margin: '2px 0', fontSize: 13 }}>Captions for {VIDEO_LABEL[video.kind]} videos are added on {VIDEO_LABEL[video.kind]}; viewers turn them on in the player.</p>}
      {watchRequired && video && !video.trackable && <p className="warn" style={{ margin: '2px 0' }}>This video can’t be held to the watch requirement. Upload the file, or use YouTube or Vimeo, to require it.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/** Videos found for this equipment (not reviewed by Preciops): preview, then choose one for the lesson. */
function Suggestions({ certType, lessonTitle, index, onUse }: { certType: string; lessonTitle: string; index: number; onUse: (url: string) => void }) {
  const list = suggestionsFor(certType, lessonTitle);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  if (!list.length) return null;
  const fitting = list.filter((s) => s.fits).length;
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="linkish" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide suggested videos' : `Suggested videos (${fitting ? `${fitting} for this lesson` : list.length})`}
      </button>
      {open && (
        <div className="list" style={{ marginTop: 6 }} aria-label={`Suggested videos for lesson ${index + 1}`}>
          <p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>Found on YouTube; Preciops hasn’t reviewed them. Watch the whole video and make sure it matches your equipment and sites before using it. They play from YouTube (nothing is copied).</p>
          {list.map((s) => {
            const v = videoEmbed(s.url);
            return (
              <div key={s.url} className="li" style={{ display: 'block' }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', margin: 0, flexWrap: 'wrap' }}>
                  <span className="x"><span><b>{s.title}</b>{s.fits && <span className="pill g" style={{ marginLeft: 6, display: 'inline-block' }}>Fits this lesson</span>}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 13 }}>{s.source}{v && !v.trackable ? ' · can’t report how much was watched' : ''}{s.note ? ` · ${s.note}` : ''}</span></span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {v && <button type="button" className="btn ghost sm" onClick={() => setPreview(preview === s.url ? null : s.url)}>{preview === s.url ? 'Hide' : 'Preview'}</button>}{' '}
                    <button type="button" className="btn sm" onClick={() => onUse(s.url)}>Use this video</button>
                  </span>
                </div>
                {preview === s.url && v && <div style={{ marginTop: 6 }}><LessonVideo video={v} title={s.title} src={v.src} /></div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
