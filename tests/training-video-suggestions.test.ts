import { describe, expect, it } from 'vitest';
import { SUGGESTED_VIDEOS, suggestionsFor } from '@/lib/training-videos';
import { TEMPLATES } from '@/lib/training-templates';
import { CourseBody, videoEmbed } from '@/lib/training';

describe('suggested training videos', () => {
  const templates = Object.values(TEMPLATES).map((t) => t.course);
  it('are only for built-in courses, point at real lessons, and play inside the lesson', () => {
    for (const [certType, list] of Object.entries(SUGGESTED_VIDEOS)) {
      const course = templates.find((c) => c.certType === certType);
      expect(course, certType).toBeTruthy();
      for (const s of list) {
        expect(videoEmbed(s.url), s.url).not.toBeNull();
        expect(videoEmbed(s.url)!.kind).toBe('youtube');
        for (const l of s.lessons) expect(course!.lessons.map((x) => x.title), `${s.title} → ${l}`).toContain(l);
        // An admin choosing one produces a course that saves.
        expect(CourseBody.safeParse({ ...course, lessons: course!.lessons.map((x, i) => (i === 0 ? { ...x, videoUrl: s.url } : x)) }).success).toBe(true);
      }
    }
  });
  it('lists the ones made for the lesson first', () => {
    const r = suggestionsFor('Scissor lift (MEWP Group A)', 'Before you start: inspection and the work area');
    expect(r.filter((s) => s.fits).map((s) => s.title)).toEqual(['Scissor Lift Walk Around Inspection', 'Electric Scissor Lift Training']);
    expect(r.at(-1)!.fits).toBe(false);
    expect(suggestionsFor('Crane operator – employer evaluation', 'Before the lift')).toEqual([]);
  });
  it('plays YouTube playlists as a series that can’t be held to a watch requirement', () => {
    expect(videoEmbed('https://www.youtube.com/playlist?list=PLOLtJdqw6o6aUJhg5XTfOtZd69Wm1jjGb')).toEqual({ kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/videoseries?list=PLOLtJdqw6o6aUJhg5XTfOtZd69Wm1jjGb&rel=0', trackable: false });
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLOLtJdqw6o6aUJhg5XTfOtZd69Wm1jjGb')!.trackable).toBe(true); // one video from a playlist
  });
});
