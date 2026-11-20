'use client';
import { useEffect, useRef } from 'react';
import { SEGMENTS, type Video } from '@/lib/training';

export type WatchReport = { segments: number[]; seconds: number; duration: number };

/**
 * Plays a lesson video inline and reports how much was watched. Uploaded videos and direct video files use the
 * browser's own player (with captions); YouTube and Vimeo use their players' progress events; Loom and Google Drive
 * play but can't report progress. Only time actually played counts: skipping ahead doesn't fill in the pieces skipped.
 */
export default function LessonVideo({ video, src, captions, title, onReport }: {
  video: Video; src: string; captions?: string | null; title: string; onReport?: (r: WatchReport) => void;
}) {
  const tracker = useTracker(onReport);
  const frame = useRef<HTMLIFrameElement>(null);

  const tracking = !!onReport;
  useEffect(() => {
    if (!tracking) return;
    if (video.kind === 'vimeo') return vimeo(frame.current, tracker);
    if (video.kind === 'youtube') return youtube(frame.current, tracker);
  }, [video.kind, video.src, tracking, tracker]);

  if (video.kind === 'upload' || video.kind === 'file') {
    return (
      <video
        controls playsInline preload="metadata" src={src} style={{ width: '100%', maxHeight: 420, background: '#000', borderRadius: 8 }} aria-label={`Video: ${title}`}
        onTimeUpdate={(e) => tracker.sample(e.currentTarget.currentTime, e.currentTarget.duration, !e.currentTarget.paused)}
        onPause={() => tracker.flush()} onEnded={() => tracker.flush()}
      >
        {captions && <track kind="captions" src={captions} srcLang="en" label="English" default />}
        Your browser can’t play this video.
      </video>
    );
  }
  return (
    <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 8, overflow: 'hidden', background: '#000' }}>
      <iframe
        ref={frame} src={video.src} title={`Video: ${title}`} loading="lazy" allowFullScreen
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media" referrerPolicy="strict-origin-when-cross-origin"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}

type Tracker = { sample: (t: number, duration: number, playing: boolean) => void; flush: () => void };

/** Collects the 1% pieces played and seconds of playback, and reports them every 15 seconds and on pause/leave. */
function useTracker(onReport?: (r: WatchReport) => void): Tracker {
  const st = useRef({ segs: new Set<number>(), seconds: 0, duration: 0, last: -1, sent: Date.now() });
  const cb = useRef(onReport);
  cb.current = onReport;
  const api = useRef<Tracker>();
  if (!api.current) {
    const flush = () => {
      const s = st.current;
      if (!cb.current || (!s.segs.size && s.seconds < 1)) return;
      cb.current({ segments: [...s.segs], seconds: Math.round(s.seconds), duration: s.duration });
      s.segs = new Set(); s.seconds = 0; s.sent = Date.now();
    };
    api.current = {
      flush,
      sample(t, duration, playing) {
        const s = st.current;
        if (!Number.isFinite(duration) || duration <= 0) return;
        s.duration = duration;
        // Normal playback moves forward a little between samples; a jump is a seek, which counts for nothing.
        const prev = s.last < 0 && t < 3 ? 0 : s.last; // the first report after starting from the beginning
        if (playing && prev >= 0 && t > prev && t - prev < 3) {
          s.seconds += t - prev;
          const from = Math.floor((prev / duration) * SEGMENTS), to = Math.floor((t / duration) * SEGMENTS);
          for (let i = from; i <= Math.min(to, SEGMENTS - 1); i++) s.segs.add(i);
        }
        if (t >= duration - 0.5 && playing) s.segs.add(SEGMENTS - 1);
        s.last = t;
        if (Date.now() - s.sent > 15000) flush();
      },
    };
  }
  useEffect(() => {
    const t = api.current!;
    const hide = () => { if (document.visibilityState === 'hidden') t.flush(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); t.flush(); };
  }, []);
  return api.current;
}

/** Vimeo's player API over postMessage: listen for timeupdate. */
function vimeo(el: HTMLIFrameElement | null, t: Tracker) {
  if (!el) return;
  const post = (m: object) => el.contentWindow?.postMessage(JSON.stringify(m), 'https://player.vimeo.com');
  const on = (ev: MessageEvent) => {
    if (ev.origin !== 'https://player.vimeo.com' || ev.source !== el.contentWindow) return;
    let d: { event?: string; data?: { seconds?: number; duration?: number } };
    try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
    if (d.event === 'ready') for (const value of ['timeupdate', 'pause', 'ended']) post({ method: 'addEventListener', value });
    else if (d.event === 'timeupdate' && d.data) t.sample(d.data.seconds ?? 0, d.data.duration ?? 0, true);
    else if (d.event === 'pause' || d.event === 'ended') t.flush();
  };
  window.addEventListener('message', on);
  const ping = setTimeout(() => post({ method: 'ping' }), 1500);
  return () => { clearTimeout(ping); window.removeEventListener('message', on); };
}

type YTPlayer = { getCurrentTime: () => number; getDuration: () => number; getPlayerState: () => number; destroy: () => void };
type YTNamespace = { Player: new (el: HTMLIFrameElement, o: object) => YTPlayer };
let ytReady: Promise<YTNamespace> | null = null;
const loadYouTube = () => (ytReady ??= new Promise<YTNamespace>((resolve) => {
  const w = window as unknown as { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return resolve(w.YT);
  const prev = w.onYouTubeIframeAPIReady;
  w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT!); };
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.async = true;
  document.head.appendChild(s);
}));

/** YouTube's IFrame API: sample the playhead every second while it plays. */
function youtube(el: HTMLIFrameElement | null, t: Tracker) {
  if (!el) return;
  let player: YTPlayer | null = null, timer: ReturnType<typeof setInterval> | null = null, gone = false;
  loadYouTube().then((YT) => {
    if (gone) return;
    player = new YT.Player(el, {
      events: {
        onStateChange: (e: { data: number }) => {
          if (e.data === 1 && !timer) timer = setInterval(() => player && t.sample(player.getCurrentTime(), player.getDuration(), player.getPlayerState() === 1), 1000);
          if (e.data !== 1) { if (timer) clearInterval(timer); timer = null; if (player) t.sample(player.getCurrentTime(), player.getDuration(), false); t.flush(); }
        },
      },
    });
  });
  return () => { gone = true; if (timer) clearInterval(timer); };
}
