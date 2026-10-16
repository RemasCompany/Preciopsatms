// Candidate–job match scoring. Pure functions: only job-related facts (skills, experience, title, certifications,
// location, pay and availability) are used — never age, gender, race or any other protected characteristic, and
// never the EEO self-identification data. Every point is explained so a recruiter can see why someone ranks where they do.

export type MatchJob = {
  title: string; skills: string[]; requiredCerts: string[]; sector: string | null; location: string | null; remote: boolean;
  payRate: number | null; description: string | null;
};
export type MatchCandidate = {
  title: string | null; skills: string[]; certs: string[]; summary: string | null; sector: string | null; location: string | null;
  yearsExp: number | null; desiredRate: number | null; availability: string | null;
  /** Credential types that are current (not expired). */
  credentials: string[];
};
export type Factor = { key: 'skills' | 'experience' | 'title' | 'certs' | 'location' | 'pay' | 'availability'; label: string; points: number; max: number; note: string };
export type Match = { score: number; factors: Factor[]; matched: string[]; missing: string[]; certGaps: string[] };

// How much each factor counts. Skills matter most, then experience and the kind of role.
export const WEIGHTS = { skills: 40, experience: 15, title: 15, certs: 10, location: 10, pay: 5, availability: 5 } as const;
const STOP = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'with', 'on', 'at', 'ii', 'iii', 'i', 'sr', 'jr', 'senior', 'junior', 'lead', 'shift', 'day', 'night', '1st', '2nd', '3rd']);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();
const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(?<=[a-z]{3})s$/, ''));
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * How well a candidate covers one job skill: 1 when they list it (or a more specific form of it), 0.75 when they list a
 * broader form ("Forklift" for "Sit-down forklift"), 0.5 when their profile mentions it, 0.25 when it mentions the main word.
 */
function skillHit(skill: string, listed: string[], text: string) {
  const s = words(skill);
  if (!s.length) return 0;
  let best = 0;
  for (const l of listed) {
    const w = words(l);
    if (norm(l) === norm(skill) || s.every((x) => w.includes(x))) return 1;
    if (w.length && w.every((x) => s.includes(x))) best = 0.75;
  }
  if (best) return best;
  const t = ` ${words([text, ...listed].join(' ')).join(' ')} `;
  if (s.every((x) => t.includes(` ${x} `))) return 0.5;
  return t.includes(` ${s[s.length - 1]} `) ? 0.25 : 0;
}

/** "3+ years", "at least 2 years", "two years" in a job description. */
export function yearsWanted(description: string | null) {
  if (!description) return null;
  const nums: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10 };
  const m = description.toLowerCase().match(/(\d{1,2}|one|two|three|four|five|six|seven|eight|ten)\s*\+?\s*(?:or more\s*)?(?:years?|yrs?)/);
  return m ? (nums[m[1]] ?? Number(m[1])) : null;
}

const place = (loc: string | null) => {
  const [city = '', state = ''] = (loc ?? '').split(',').map((x) => x.trim().toLowerCase());
  return { city, state: state.slice(0, 2) };
};

export function scoreMatch(job: MatchJob, c: MatchCandidate): Match {
  const factors: Factor[] = [];
  const text = [c.title, c.summary, c.certs.join(' ')].filter(Boolean).join(' ');

  // Skills: the share of the job's skills the candidate has (listed counts fully, mentioned in their profile half).
  let matched: string[] = [], missing: string[] = [];
  if (job.skills.length) {
    let got = 0;
    for (const s of job.skills) { const h = skillHit(s, [...c.skills, ...c.certs], text); got += h; (h ? matched : missing).push(s); }
    const share = got / job.skills.length;
    factors.push({ key: 'skills', label: 'Skills', points: round(WEIGHTS.skills * share), max: WEIGHTS.skills, note: `${matched.length} of ${job.skills.length} required skills${missing.length ? ` · missing ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}` : ''}` });
  } else {
    // No skills on the job: compare the job title with what the candidate lists.
    const tw = words(job.title), cw = new Set(words([...c.skills, c.title ?? ''].join(' ')));
    const share = tw.length ? tw.filter((w) => cw.has(w)).length / tw.length : 0.5;
    factors.push({ key: 'skills', label: 'Skills', points: round(WEIGHTS.skills * share), max: WEIGHTS.skills, note: 'No skills listed on the job — compared with the job title. Add skills to the job for a sharper ranking.' });
  }

  // Experience against the years the description asks for (3 if it doesn't say).
  const want = yearsWanted(job.description), target = want ?? 3;
  const yrs = c.yearsExp;
  const exp = yrs == null ? 0.4 : clamp(yrs / target);
  factors.push({ key: 'experience', label: 'Experience', points: round(WEIGHTS.experience * exp), max: WEIGHTS.experience,
    note: yrs == null ? 'Years of experience not recorded' : `${yrs} year${yrs === 1 ? '' : 's'}${want ? ` · job asks for ${want}+` : ''}` });

  // Title: how closely their current or last title matches the job (sector match helps a little).
  const jt = words(job.title), ct = new Set(words(c.title ?? ''));
  let t = jt.length ? jt.filter((w) => ct.has(w)).length / jt.length : 0;
  const sameSector = !!job.sector && !!c.sector && job.sector === c.sector;
  if (sameSector) t = Math.max(t, 0.4);
  factors.push({ key: 'title', label: 'Role', points: round(WEIGHTS.title * clamp(t)), max: WEIGHTS.title,
    note: c.title ? `${c.title}${sameSector ? ` · ${c.sector}` : ''}` : sameSector ? `Same sector (${c.sector})` : 'No current title' });

  // Required certifications (equipment, licenses): current credentials count.
  const certGaps = job.requiredCerts.filter((r) => !c.credentials.includes(r));
  const certShare = job.requiredCerts.length ? (job.requiredCerts.length - certGaps.length) / job.requiredCerts.length : 1;
  factors.push({ key: 'certs', label: 'Certifications', points: round(WEIGHTS.certs * certShare), max: WEIGHTS.certs,
    note: !job.requiredCerts.length ? 'None required' : certGaps.length ? `Missing ${certGaps.join(', ')}` : 'Has every required certification' });

  // Location: same city, same state, or remote.
  const jp = place(job.location), cp = place(c.location);
  const loc = job.remote ? 1 : !cp.city && !cp.state ? 0.3 : jp.city && cp.city === jp.city && cp.state === jp.state ? 1 : jp.state && cp.state === jp.state ? 0.6 : 0;
  factors.push({ key: 'location', label: 'Location', points: round(WEIGHTS.location * loc), max: WEIGHTS.location,
    note: job.remote ? 'Remote job' : !c.location ? 'Location not recorded' : loc === 1 ? `Local (${c.location})` : loc ? `Same state (${c.location})` : `Lives in ${c.location}` });

  // Pay: what they want against what the job pays.
  const pay = job.payRate && c.desiredRate ? (c.desiredRate <= job.payRate ? 1 : c.desiredRate <= job.payRate * 1.1 ? 0.5 : 0) : 0.6;
  factors.push({ key: 'pay', label: 'Pay fit', points: round(WEIGHTS.pay * pay), max: WEIGHTS.pay,
    note: job.payRate && c.desiredRate ? `Wants $${c.desiredRate.toFixed(2)}/hr · job pays $${job.payRate.toFixed(2)}` : 'Pay not compared (missing a rate)' });

  // Availability: ready now beats weeks out.
  const a = (c.availability ?? '').toLowerCase();
  const av = !a ? 0.5 : /immediate|now|asap|today|available/.test(a) ? 1 : /week/.test(a) ? 0.6 : /month|\d+\s*days?/.test(a) ? 0.3 : /passive|not looking/.test(a) ? 0.2 : 0.5;
  factors.push({ key: 'availability', label: 'Availability', points: round(WEIGHTS.availability * av), max: WEIGHTS.availability, note: c.availability || 'Not recorded' });

  return { score: Math.round(factors.reduce((t, f) => t + f.points, 0)), factors, matched, missing, certGaps };
}

/** Plain-language band for a score. */
export const band = (score: number) => (score >= 75 ? 'Strong match' : score >= 55 ? 'Good match' : score >= 35 ? 'Partial match' : 'Weak match');
/** Pill colour for a score: green strong, plain good, amber partial, red weak. */
export const matchTone = (score: number) => (score >= 75 ? 'g' : score >= 55 ? '' : score >= 35 ? 'a' : 'r');
