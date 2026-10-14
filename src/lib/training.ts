// Equipment operator training: course content, quiz grading and recertification dates.
// Shared by the UI and the server — keep this file free of server imports.
import { z } from 'zod';
import { CREDENTIAL_TYPES } from './credentials';

export type Lesson = { title: string; body: string; videoUrl?: string | null };
export type Question = { q: string; choices: string[]; answer: number };
export type Status = 'assigned' | 'evaluation' | 'certified' | 'failed' | 'cancelled';
export const OPEN_STATUSES: Status[] = ['assigned', 'evaluation'];

export const STATUS_LABEL: Record<Status, string> = {
  assigned: 'Taking the course', evaluation: 'Ready for hands-on evaluation', certified: 'Certified', failed: 'Didn’t pass the evaluation', cancelled: 'Cancelled',
};
export const REASON_LABEL: Record<string, string> = { initial: 'First certification', recert: 'Recertification', refresher: 'Refresher' };

/** Credential types a course can issue (the equipment ones). */
export const EQUIPMENT_TYPES = Object.keys(CREDENTIAL_TYPES).filter((t) => CREDENTIAL_TYPES[t].group === 'Equipment');

/** When OSHA 1910.178(l)(4)(ii) requires refresher training (plus an evaluation) before someone operates again. */
export const REFRESHER_TRIGGERS = [
  'Seen operating the truck unsafely',
  'Involved in an accident or near-miss',
  'Evaluation found they weren’t operating safely',
  'Assigned to a different type of truck',
  'A change in the workplace affects safe operation',
] as const;

/** OSHA requires an evaluation at least every three years, so recertification can't be set longer. */
export const MAX_RECERT_MONTHS = 36;
export const RECERT_WINDOW_DAYS = 60;

const https = z.string().trim().max(500).refine((u) => /^https:\/\/\S+$/.test(u), 'Video links must start with https://');
export const CourseBody = z.object({
  title: z.string().trim().min(3, 'Give the course a name.').max(120),
  certType: z.string().refine((t) => EQUIPMENT_TYPES.includes(t), 'Choose the certification this course issues.'),
  description: z.string().trim().max(2000).nullable().optional(),
  recertMonths: z.coerce.number().int().min(1).max(MAX_RECERT_MONTHS, `OSHA requires a new evaluation at least every ${MAX_RECERT_MONTHS} months.`),
  passScore: z.coerce.number().int().min(50, 'Set the passing score between 50% and 100%.').max(100, 'Set the passing score between 50% and 100%.'),
  lessons: z.array(z.object({ title: z.string().trim().min(1, 'Every lesson needs a title.').max(120), body: z.string().trim().min(1, 'Every lesson needs some text.').max(8000), videoUrl: https.nullable().optional().or(z.literal('')) })).min(1, 'Add at least one lesson.').max(30),
  questions: z.array(z.object({
    q: z.string().trim().min(3, 'Every question needs text.').max(400),
    choices: z.array(z.string().trim().min(1, 'Fill in every answer choice.').max(200)).min(2, 'Each question needs at least two choices.').max(6),
    answer: z.number().int().min(0),
  }).refine((x) => x.answer < x.choices.length, 'Mark the correct answer for every question.')).min(3, 'Add at least three quiz questions.').max(50),
  checklist: z.array(z.string().trim().min(1).max(200)).min(1, 'Add at least one item to the hands-on evaluation checklist.').max(40),
});
export type CourseInput = z.infer<typeof CourseBody>;

/** Grades a quiz. Unanswered questions count as wrong. Returns the percent score and which questions were missed. */
export function grade(questions: Question[], answers: (number | null)[], passScore: number) {
  const wrong = questions.map((q, i) => (answers[i] === q.answer ? -1 : i)).filter((i) => i >= 0);
  const score = questions.length ? Math.round(((questions.length - wrong.length) / questions.length) * 100) : 0;
  return { score, passed: score >= passScore, wrong };
}

/** The certification's expiry: the evaluation date plus the recertification period (clamped to month ends, e.g. Jan 31 + 1 month = Feb 28). */
export function recertDate(evaluatedAt: string, months: number) {
  const [y, m, d] = evaluatedAt.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** A starting course for sit-down forklifts, based on OSHA 29 CFR 1910.178(l). Companies should review and add site-specific topics. */
export const FORKLIFT_TEMPLATE: CourseInput = {
  title: 'Forklift operator – sit-down counterbalance',
  certType: 'Forklift – sit-down counterbalance',
  description: 'Formal instruction for powered industrial truck operators, based on OSHA 29 CFR 1910.178(l). After the quiz, a qualified trainer gives hands-on practice and evaluates the operator on the truck and in the workplace they’ll actually use. Review this course with your safety lead and add anything specific to your clients’ sites.',
  recertMonths: 36,
  passScore: 80,
  lessons: [
    { title: 'Who may operate a forklift', body: 'Only operators who have been trained and evaluated may drive a forklift. Training covers the type of truck you will use and the workplace you will use it in, so a certification on one type of truck does not cover another.\n\nYou must be at least 18 years old to operate a forklift at work.\n\nYour skills are evaluated at least every three years. You will also need refresher training and a new evaluation if you are seen operating unsafely, are involved in an accident or near-miss, are moved to a different type of truck, or if something changes in the workplace that affects safe operation.\n\nThis online course is the classroom part of your training. It does not certify you on its own: a qualified trainer must also give you hands-on practice and watch you operate the truck.' },
    { title: 'Know your truck', body: 'Read the operator’s manual and the warnings on the truck.\n\nThe data plate (nameplate) shows the truck’s rated capacity at a stated load center, and how attachments change it. Never lift more than the data plate allows. If the plate is missing or can’t be read, don’t use the truck.\n\nA sit-down counterbalanced forklift steers with the rear wheels, so the back end swings wide when you turn. Watch your tail swing near people, racks and walls.\n\nThe truck and its load balance over a “stability triangle” between the front wheels and the rear axle pivot. Raising the load, tilting it forward, turning sharply, braking hard or driving on a slope moves the center of gravity and can tip the truck. Most tip-overs happen when turning too fast or turning with the load raised.\n\nKnow every control and gauge before you drive: travel direction and speed, brakes, horn, lift, tilt and side-shift.' },
    { title: 'Pre-use inspection', body: 'Inspect the truck before every shift (after each shift if it runs around the clock) and before using it if someone else had it.\n\nCheck: tires and wheels; forks for cracks, bends or wear; chains and mast; hydraulic hoses and cylinders for leaks; fluid levels; battery connections or the LP tank, its fittings and hose; the horn, lights and backup alarm; the seat belt and overhead guard; the brakes, parking brake and steering; and the lift, tilt and side-shift controls.\n\nIf anything is wrong, do not use the truck. Take it out of service, tag it so no one else uses it, and report it to your supervisor. Only authorized people may repair it.' },
    { title: 'Driving safely', body: 'Wear your seat belt. Get on and off using three points of contact, and never jump off.\n\nTravel with the forks low, a few inches off the floor, and tilted back. Look in the direction you are traveling. If the load blocks your view forward, drive in reverse.\n\nKeep to safe speeds. Slow down and sound the horn at intersections, corners, doorways and anywhere you can’t see. Keep about three truck lengths behind the truck ahead.\n\nPedestrians have the right of way. Never let anyone stand or walk under raised forks, and never give anyone a ride on the forks or the truck.\n\nKeep your arms, legs and head inside the truck. Watch for overhead clearance at doors, pipes, sprinklers and lights.' },
    { title: 'Loads, ramps and stability', body: 'Pick up a load only if it is within the rated capacity and is stable and secure. Insert the forks fully, center the load, keep it against the backrest, and tilt it back before traveling.\n\nRaise or lower a load only when the truck is stopped. Stack straight and lower slowly.\n\nOn ramps and grades, drive with the load pointing uphill: forward going up, reverse going down. With no load, keep the forks pointing downhill. Never turn on a ramp or grade.\n\nIf a sit-down forklift starts to tip over, do not jump. Stay in the seat, hold the steering wheel tightly, brace your feet and lean away from the direction it is falling. This is why the seat belt matters.' },
    { title: 'Workplace hazards', body: 'Watch the floor for spills, holes, debris and uneven surfaces, and check that floors and trailer beds can hold the truck and load.\n\nAt loading docks, make sure the trailer wheels are chocked or the trailer is locked to the dock, and that dock plates are secure and rated for the load. Keep away from the dock edge.\n\nInside buildings, engine-powered trucks give off carbon monoxide. Make sure the area is ventilated, and tell your supervisor if you get a headache or feel dizzy.\n\nCharge batteries only in the charging area. No smoking or open flames there, wear the required eye and face protection, and know where the eyewash is. Turn the engine off to refuel or change an LP tank.\n\nFollow your site’s traffic rules, posted speed limits, marked aisles and pedestrian walkways.' },
    { title: 'Parking and leaving the truck', body: 'Whenever you leave the truck unattended (out of sight, or more than 25 feet away), lower the forks fully to the floor, put the controls in neutral, shut off the power and set the parking brake. If it’s parked on an incline, block the wheels.\n\nIf you stay within 25 feet and can see the truck, still lower the forks, put the controls in neutral and set the brake.\n\nPark only in designated areas, never blocking exits, fire equipment, electrical panels or aisles.' },
  ],
  questions: [
    { q: 'Who may operate a forklift at work?', choices: ['Anyone with a driver’s license', 'Anyone who has watched a coworker do it', 'Only someone trained and evaluated on that type of truck', 'Anyone over 16'], answer: 2 },
    { q: 'How often must an operator’s skills be evaluated, at a minimum?', choices: ['Every year', 'Every three years', 'Every five years', 'Only once'], answer: 1 },
    { q: 'Where do you find how much the truck can safely lift?', choices: ['The data plate on the truck', 'Ask a coworker', 'It depends on how strong the hydraulics feel', 'The warehouse floor plan'], answer: 0 },
    { q: 'How should you carry a load while traveling?', choices: ['Raised high so you can see under it', 'Low, a few inches off the floor, and tilted back', 'Tilted forward so it’s level', 'At chest height'], answer: 1 },
    { q: 'The load blocks your view forward. What do you do?', choices: ['Drive forward slowly and lean out to see', 'Drive in reverse, looking where you are going', 'Ask someone to ride on the truck and guide you', 'Raise the load higher'], answer: 1 },
    { q: 'You are driving a loaded forklift up a ramp. Which way should the load face?', choices: ['Uphill (drive forward going up)', 'Downhill (reverse going up)', 'It doesn’t matter', 'Sideways'], answer: 0 },
    { q: 'Your sit-down forklift starts to tip over. What should you do?', choices: ['Jump clear as fast as you can', 'Stay in the seat, hold on, brace your feet and lean away from the fall', 'Raise the forks to balance it', 'Turn the wheel sharply'], answer: 1 },
    { q: 'During your pre-shift check you find a leaking hydraulic hose. What now?', choices: ['Use it carefully and report it at the end of the shift', 'Fix it yourself with tape', 'Take it out of service, tag it and report it', 'Ignore it if it’s a small leak'], answer: 2 },
    { q: 'You are walking away from the forklift to get paperwork. What must you do first?', choices: ['Leave the forks raised so they’re ready', 'Lower the forks fully, put the controls in neutral, shut off the power and set the brake', 'Leave it running so it stays warm', 'Nothing if you’ll be back in five minutes'], answer: 1 },
    { q: 'A coworker asks for a ride across the warehouse on your forklift. You:', choices: ['Let them stand on the forks', 'Let them sit on the counterweight', 'Say no: riders are never allowed', 'Let them ride if you drive slowly'], answer: 2 },
    { q: 'How far behind another truck should you keep?', choices: ['One truck length', 'About three truck lengths', 'Close enough to talk', 'Distance doesn’t matter indoors'], answer: 1 },
    { q: 'You nearly hit a pedestrian. What happens next?', choices: ['Nothing if no one was hurt', 'Report it; you’ll need refresher training and a new evaluation', 'Keep it quiet so you don’t lose hours', 'Sound the horn more often'], answer: 1 },
  ],
  checklist: [
    'Does a complete pre-use inspection and recognizes defects',
    'Wears the seat belt; gets on and off with three points of contact',
    'Travels with forks low and tilted back at a safe speed',
    'Looks in the direction of travel; sounds the horn at intersections and blind spots',
    'Picks up a load correctly: within capacity, forks fully in, centered, tilted back',
    'Stacks and unstacks at height smoothly and safely',
    'Drives on ramps and grades correctly (if the site has them)',
    'Maneuvers in aisles and tight spaces without contact, watching tail swing',
    'Yields to pedestrians and keeps a safe following distance',
    'Parks correctly: forks down, controls neutral, power off, brake set',
  ],
};

/** Whether a quiz payload is a valid answer sheet for this course. */
export const AnswersBody = z.object({ answers: z.array(z.number().int().min(0).nullable()).max(50) });
