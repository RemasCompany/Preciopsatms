// Suggested videos for the built-in courses. Shared by the UI and the server — keep this file free of server imports.
//
// These were found by web search (title and link only) and have NOT been reviewed by Preciops. They are only
// suggestions: an admin previews each one and chooses "Use this video" before any worker sees it. They are embedded
// from YouTube (never downloaded or re-hosted), so the owner's player, captions and terms apply. Federal OSHA doesn't
// publish forklift or aerial lift training videos, so these come from manufacturers and training providers.
export type SuggestedVideo = {
  title: string;
  url: string;
  source: string; // who published it, as far as the listing shows
  note?: string; // anything to check while previewing
  lessons: string[]; // lesson titles (from the built-in course) it fits; empty = the course as a whole
};

/** By the certification the course issues, so a course built from the template (or a custom one for the same equipment) gets them. */
export const SUGGESTED_VIDEOS: Record<string, SuggestedVideo[]> = {
  'Forklift – sit-down counterbalance': [
    { title: 'Forklift Operator Safety Training', url: 'https://www.youtube.com/watch?v=Idp7qPJzYGE', source: 'YouTube (training provider)', note: 'Built around OSHA 29 CFR 1910.178. Check it shows sit-down trucks like yours.', lessons: ['Who may operate a forklift', 'Driving safely'] },
    { title: 'Forklift Safety Training: OSHA Requirements & Common Hazards Explained', url: 'https://www.youtube.com/watch?v=ehn3VNvJtx8', source: 'YouTube (training provider)', lessons: ['Workplace hazards', 'Who may operate a forklift'] },
    { title: 'Forklift Safety Training (English) 2026', url: 'https://www.youtube.com/watch?v=kdMOm3R3hRU', source: 'YouTube (training provider)', note: 'May be a preview of a paid course. Make sure it teaches, rather than advertises.', lessons: [] },
    { title: 'Forklift Safety Training Videos (playlist)', url: 'https://www.youtube.com/playlist?list=PLS6lvT3vUNjwmlAzvA-PdIpeG2LmgQY9j', source: 'YouTube (training provider)', note: 'A playlist: pre-operational checks, loading and picking, three points of contact, pedestrians. Playlists can’t report how much was watched.', lessons: ['Pre-use inspection', 'Loads, ramps and stability'] },
  ],
  'Scissor lift (MEWP Group A)': [
    { title: 'Scissor Lift Walk Around Inspection', url: 'https://www.youtube.com/watch?v=GJ9A263MgVA', source: 'YouTube', lessons: ['Before you start: inspection and the work area'] },
    { title: 'Electric Scissor Lift Training', url: 'https://www.youtube.com/watch?v=JHqbZhsT1I4', source: 'Skyjack (manufacturer)', note: 'Pre-operation safety checks on a Skyjack electric scissor lift.', lessons: ['Before you start: inspection and the work area', 'Operating safely'] },
    { title: 'How to Operate a Genie GS-1932 Scissor Lift', url: 'https://www.youtube.com/watch?v=3zb3no_lAYg', source: 'YouTube (rental/dealer)', note: 'One model: controls, batteries and emergency lowering. Best if your sites use Genie GS lifts.', lessons: ['Know your machine', 'Emergencies and rescue'] },
  ],
  'Boom lift (MEWP Group B)': [
    { title: 'JLG Boom Lifts (playlist)', url: 'https://www.youtube.com/playlist?list=PLOLtJdqw6o6aUJhg5XTfOtZd69Wm1jjGb', source: 'JLG (manufacturer)', note: 'JLG’s boom lift operator videos. A playlist can’t report how much was watched; pick a single video from it for that.', lessons: ['Know your machine', 'Operating safely'] },
  ],
};

/** Suggestions for one lesson: the ones made for it first, then the rest for the course. */
export function suggestionsFor(certType: string, lessonTitle: string) {
  const all = SUGGESTED_VIDEOS[certType] ?? [];
  const t = lessonTitle.trim().toLowerCase();
  const fits = (s: SuggestedVideo) => s.lessons.some((l) => l.toLowerCase() === t);
  return [...all.filter(fits).map((s) => ({ ...s, fits: true })), ...all.filter((s) => !fits(s)).map((s) => ({ ...s, fits: false }))];
}
