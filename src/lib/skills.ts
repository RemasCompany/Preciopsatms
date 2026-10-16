// Reading skills, certifications, experience, title and location out of resume text — locally, with no AI model, so
// it can run on every application without spending credits or sending anyone's resume anywhere. Only work facts are
// read: education dates are skipped so nothing hints at age, and nothing about protected characteristics is looked for.

/** Common staffing skills, by kind of work. Each company's own job skills are added on top. */
const SKILLS = [
  // Warehouse & light industrial
  'Forklift', 'Sit-down forklift', 'Stand-up forklift', 'Reach truck', 'Order picker', 'Pallet jack', 'Electric pallet jack', 'Cherry picker', 'Scissor lift', 'Boom lift', 'Telehandler',
  'RF scanner', 'Pick and pack', 'Order picking', 'Packing', 'Shipping and receiving', 'Loading and unloading', 'Inventory', 'Cycle counting', 'Material handling', 'Palletizing',
  'Assembly', 'Machine operation', 'CNC', 'Quality control', 'Quality inspection', 'Production line', 'Sanitation', 'Lean manufacturing', '5S', 'Blueprint reading', 'Welding', 'MIG welding', 'TIG welding', 'Soldering',
  'WMS', 'SAP', 'Hazmat', 'Lockout/tagout',
  // Driving
  'CDL', 'CDL Class A', 'CDL Class B', 'Box truck', 'Delivery driving', 'Route planning', 'DOT regulations', 'ELD',
  // Construction & trades
  'Carpentry', 'Framing', 'Drywall', 'Painting', 'Concrete', 'Roofing', 'Plumbing', 'Electrical', 'HVAC', 'Power tools', 'General labor', 'Landscaping', 'Demolition', 'Flagging',
  // Healthcare
  'Patient care', 'Vital signs', 'Phlebotomy', 'Medication administration', 'Wound care', 'IV therapy', 'Charting', 'EMR', 'Epic', 'Cerner', 'Med-Surg', 'Telemetry', 'ICU', 'Home health', 'Dementia care', 'Medical billing', 'Medical coding', 'HIPAA',
  // Office & admin
  'Microsoft Office', 'Excel', 'Word', 'PowerPoint', 'Outlook', 'Google Workspace', 'Data entry', 'Typing', 'Scheduling', 'Phones', 'Reception', 'Filing', 'Bookkeeping', 'Accounts payable', 'Accounts receivable', 'Payroll', 'QuickBooks', 'Invoicing', 'Customer service', 'Call center', 'Salesforce', 'CRM', 'Bilingual', 'Spanish',
  // Hospitality & retail
  'Cash handling', 'POS', 'Food prep', 'Line cook', 'Food safety', 'Barista', 'Bartending', 'Serving', 'Housekeeping', 'Front desk', 'Merchandising', 'Stocking', 'Event setup',
  // Technology
  'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Java', 'C#', '.NET', 'SQL', 'PostgreSQL', 'AWS', 'Azure', 'Docker', 'Kubernetes', 'Linux', 'Git', 'Help desk', 'Active Directory', 'Networking', 'Tableau', 'Power BI',
  // People
  'Team leadership', 'Supervision', 'Training', 'Safety', 'OSHA compliance',
];
/** Licenses and certifications people list on resumes. */
const CERTS = ['CNA', 'RN', 'LPN', 'BLS', 'ACLS', 'PALS', 'CPR', 'First Aid', 'OSHA 10', 'OSHA 30', 'ServSafe', 'TWIC', 'Forklift certification', 'Hazmat endorsement', 'Tanker endorsement', 'CompTIA A+', 'Security+', 'PMP', 'Notary', 'Real estate license', 'Phlebotomy certification', 'CMA', 'EMT', 'Pharmacy technician'];
/** Other ways people write the same thing. */
const ALIASES: Record<string, string[]> = {
  Forklift: ['fork lift', 'forklift operator', 'lift truck', 'hi-lo', 'hilo'], 'RF scanner': ['rf gun', 'rf scanning', 'handheld scanner', 'barcode scanner', 'scan gun'],
  'Pallet jack': ['pallet jacks', 'pallet truck'], 'Electric pallet jack': ['electric pallet jacks', 'ept', 'walkie rider'], 'Reach truck': ['reach trucks'], 'Order picker': ['order pickers'],
  'CDL Class A': ['class a cdl', 'cdl-a', 'cdl a', 'class a license'], 'CDL Class B': ['class b cdl', 'cdl-b', 'cdl b'], CDL: ['commercial driver', "commercial driver's license"],
  'Shipping and receiving': ['shipping & receiving', 'shipping/receiving', 'receiving'], 'Loading and unloading': ['loading/unloading', 'loading & unloading', 'loaded trucks', 'unloaded trucks', 'loading trucks', 'unloading trucks'],
  'Pick and pack': ['pick & pack', 'pick/pack', 'picker packer', 'picker/packer'], 'Cycle counting': ['cycle counts', 'cycle count'], 'Lockout/tagout': ['lockout tagout', 'loto'],
  'Microsoft Office': ['ms office', 'microsoft office suite', 'office 365', 'microsoft 365'], Excel: ['ms excel', 'microsoft excel'], Word: ['ms word', 'microsoft word'],
  'Customer service': ['customer support', 'customer care'], 'Data entry': ['data-entry'], Phones: ['answering phones', 'multi-line phone', 'switchboard'],
  'Accounts payable': ['a/p'], 'Accounts receivable': ['a/r'], POS: ['point of sale', 'cash register'], 'Cash handling': ['handled cash', 'cash management', 'cashier'],
  'Food safety': ['food handler'], 'Patient care': ['direct patient care'], 'Vital signs': ['vitals'], EMR: ['electronic medical records', 'ehr', 'electronic health records'],
  'Medication administration': ['med pass', 'administering medication', 'administered medications'], 'Team leadership': ['team lead', 'led a team', 'leading a team'], Supervision: ['supervised', 'supervisor'],
  'Node.js': ['nodejs', 'node'], JavaScript: ['javascript', 'js', 'es6'], 'C#': ['c sharp'], PostgreSQL: ['postgres'], Kubernetes: ['k8s'], 'Help desk': ['helpdesk', 'service desk', 'desktop support'],
  Bilingual: ['bilingual english/spanish', 'bilingual spanish'], Spanish: ['fluent in spanish', 'spanish speaking', 'speak spanish'], 'OSHA compliance': ['osha regulations'],
  CNA: ['certified nursing assistant', 'certified nurse aide'], RN: ['registered nurse'], LPN: ['licensed practical nurse', 'lvn', 'licensed vocational nurse'],
  BLS: ['basic life support'], ACLS: ['advanced cardiac life support'], CPR: ['cpr certified', 'cpr/aed'], 'OSHA 10': ['osha-10', 'osha 10-hour', 'osha 10 hour'], 'OSHA 30': ['osha-30', 'osha 30-hour', 'osha 30 hour'],
  'Forklift certification': ['forklift certified', 'forklift certificate', 'certified forklift', 'forklift license'], EMT: ['emergency medical technician'], CMA: ['certified medical assistant'],
  'Pharmacy technician': ['pharmacy tech', 'cpht'], 'Hazmat endorsement': ['hazmat endorsed', 'h endorsement'], 'Tanker endorsement': ['n endorsement'],
};
// Short or common words that would match by accident; they only count as written (case-sensitive) or via an alias.
const EXACT_CASE = new Set(['RN', 'EMT', 'CMA', 'CNA', 'LPN', 'BLS', 'POS', 'CRM', 'EMR', 'SAP', 'WMS', 'ELD', 'ICU', 'CNC', 'SQL', 'AWS', 'PMP', 'TWIC', 'CDL', '5S', 'Git', 'Word', 'Java', 'Epic', 'Training', 'Safety', 'Serving', 'Filing', 'Typing', 'Packing', 'Stocking', 'Phones']);

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'.split(' '));
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lower = (s: string) => s.toLowerCase().replace(/[‐-―]/g, '-').replace(/[^\S\n]+/g, ' ');

/** Splits resume text into sections by their headings ("Experience", "Education"…). */
function sections(text: string) {
  const HEAD = /^\s*(work experience|professional experience|employment history|work history|experience|employment|relevant experience|education|education and training|skills|technical skills|core competencies|certifications?|licenses?(?: and certifications?)?|certifications? (?:and|&) licenses?|summary|professional summary|profile|objective|references|training|volunteer(?: experience)?|awards|projects)\s*:?\s*$/i;
  const out: { head: string; body: string[] }[] = [{ head: 'top', body: [] }];
  for (const line of text.split('\n')) {
    const m = line.match(HEAD);
    if (m && line.trim().length < 45) out.push({ head: m[1].toLowerCase(), body: [] }); else out[out.length - 1].body.push(line);
  }
  return out.map((s) => ({ head: s.head, text: s.body.join('\n') }));
}
const isWork = (h: string) => /experience|employment|work history/.test(h) && !/volunteer/.test(h);
const isSchool = (h: string) => /education/.test(h);

/** Phrases to look for: the built-in list plus the company's own job skills and titles, each with its aliases. */
function vocabulary(extra: string[]) {
  const seen = new Map<string, string>();
  for (const s of [...extra, ...SKILLS]) { const k = s.trim().toLowerCase(); if (k && k.length <= 60 && !seen.has(k)) seen.set(k, s.trim()); }
  return [...seen.values()];
}
function found(term: string, text: string, raw: string) {
  const pats = [term, ...(ALIASES[term] ?? [])];
  return pats.some((p, i) => {
    if (i === 0 && (EXACT_CASE.has(p) || p.length <= 3)) return new RegExp(`(^|[^A-Za-z0-9])${esc(p)}(?![A-Za-z0-9])`).test(raw);
    const words = lower(p).split(/[\s/&-]+/).filter(Boolean).map((w) => esc(w) + (/[a-z]{3}$/.test(w) ? 's?' : ''));
    return new RegExp(`(^|[^a-z0-9+#.])${words.join('[\\s/&-]+')}(?![a-z0-9+#])`).test(text);
  });
}

/** Months of work between date ranges in the work-history part of the resume ("Mar 2019 – Present", "2016 - 2018", "06/2015 to 08/2017"). */
export function workMonths(text: string, now = new Date()) {
  const D = String.raw`(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+|(\d{1,2})\s*/\s*)?((?:19|20)\d{2})`;
  const re = new RegExp(`${D}\\s*(?:-|–|—|to|through|until)\\s*(?:${D}|(present|current|now|today))`, 'gi');
  const ranges: [number, number][] = [];
  const nowM = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (const m of text.matchAll(re)) {
    const mon = (name?: string, num?: string, fallback = 0) => (name ? MONTHS[name.toLowerCase().slice(0, 4) === 'sept' ? 'sept' : name.toLowerCase().slice(0, 3)] : num ? Math.min(11, Math.max(0, +num - 1)) : fallback);
    const start = +m[3] * 12 + mon(m[1], m[2], 0);
    const end = m[7] ? nowM : +m[6] * 12 + mon(m[4], m[5], 11);
    if (end >= start && start <= nowM && end - start < 50 * 12) ranges.push([start, Math.min(end, nowM)]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0, cur: [number, number] | null = null;
  for (const r of ranges) {
    if (cur && r[0] <= cur[1] + 1) cur[1] = Math.max(cur[1], r[1]);
    else { if (cur) total += cur[1] - cur[0] + 1; cur = [...r]; }
  }
  if (cur) total += cur[1] - cur[0] + 1;
  return total;
}

export type ResumeFacts = { skills: string[]; certs: string[]; yearsExp: number | null; title: string | null; location: string | null };

/**
 * Work facts from resume text. `vocab` is the company's own job skills (and the job being applied to first), so
 * whatever recruiters rank on gets found; `titles` are its job titles, used to recognise the most recent role.
 */
export function readResume(text: string, opts: { vocab?: string[]; titles?: string[]; now?: Date } = {}): ResumeFacts {
  const secs = sections(text);
  const notSchool = secs.filter((s) => !isSchool(s.head)).map((s) => s.text).join('\n');
  const raw = secs.map((s) => s.text).join('\n'), low = lower(raw);

  const skills = vocabulary(opts.vocab ?? []).filter((t) => found(t, low, raw));
  const certs = CERTS.filter((c) => found(c, low, raw));

  // Years: from work-history date ranges; else a stated "N years of experience"; never from education dates.
  const work = secs.filter((s) => isWork(s.head)).map((s) => s.text).join('\n');
  const months = workMonths(work || notSchool.split('\n').filter((l) => !/universit|college|school|academy|degree|diploma|bachelor|master|associate|ged\b|graduat/i.test(l)).join('\n'), opts.now);
  const stated = [...low.matchAll(/(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:[a-z-]+\s+){0,3}experience/g)].map((m) => +m[1]).filter((n) => n <= 50);
  const yearsExp = months >= 6 ? Math.round(months / 12) : stated.length ? Math.max(...stated) : months > 0 ? 0 : null;

  // Title: the first line in the work history that reads like a job title the company hires for or a common role word.
  const roleWords = /\b(operator|associate|driver|technician|tech|nurse|assistant|aide|clerk|specialist|coordinator|manager|supervisor|lead|cook|server|cashier|receptionist|representative|rep|agent|developer|engineer|analyst|administrator|accountant|bookkeeper|welder|machinist|mechanic|electrician|carpenter|laborer|handler|picker|packer|loader|warehouse worker|attendant|housekeeper|caregiver|cna|medical assistant|phlebotomist|teller|consultant|designer|recruiter|dispatcher|installer|inspector|painter|plumber|forklift)\b/i;
  const titles = (opts.titles ?? []).map((t) => t.split(/[—–(-]/)[0].trim()).filter((t) => t.length > 2);
  let title: string | null = null;
  for (const line of (work || notSchool).split('\n').slice(0, 40)) {
    const l = line.split(/\s[|•·@–—-]\s|,\s|\sat\s|\t/)[0].replace(/[•*▪●]/g, '').trim();
    if (!l || l.length > 60 || /\d{4}|@|\b(inc|llc|corp|company|co\.)\b/i.test(l)) continue;
    const known = titles.find((t) => lower(l).includes(lower(t)));
    if (known || (roleWords.test(l) && l.split(/\s+/).length <= 6)) { title = l.replace(/\s+/g, ' ').replace(/[:;,.]$/, ''); break; }
  }

  // Location: a "City, ST" near the top (the contact block), never a street address.
  let location: string | null = null;
  for (const line of text.split('\n').slice(0, 10)) {
    for (const m of line.matchAll(/([A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+){0,2}),\s*([A-Z]{2})\b/g)) {
      if (US_STATES.has(m[2]) && !/\d/.test(m[1])) { location = `${m[1]}, ${m[2]}`; break; }
    }
    if (location) break;
  }
  return { skills: skills.slice(0, 30), certs, yearsExp, title, location };
}

/** Skills already on a profile plus new ones, without near-duplicates ("Forklift" and "forklift"). */
export function mergeList(have: string[], add: string[], max = 40) {
  const out = [...have], keys = new Set(have.map((s) => s.trim().toLowerCase()));
  for (const s of add) { const k = s.trim().toLowerCase(); if (k && !keys.has(k)) { keys.add(k); out.push(s.trim()); } }
  return out.slice(0, max);
}
