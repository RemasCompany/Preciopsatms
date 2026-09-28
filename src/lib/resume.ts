import { HttpError } from './http-error';
import { SECTORS } from './records';

export const RESUME_TYPES: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain', rtf: 'application/rtf',
};
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ext = (filename: string) => filename.split('.').pop()?.toLowerCase() ?? '';

/** Plain text from a resume file (PDF, Word .docx, .txt, .rtf). */
export async function extractResumeText(buf: Buffer, filename: string): Promise<string> {
  if (buf.length > MAX_RESUME_BYTES) throw new HttpError(413, 'That file is larger than 10 MB.');
  const e = ext(filename);
  let text: string;
  if (e === 'pdf' || buf.subarray(0, 5).toString() === '%PDF-') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    try { text = (await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })).text as string; }
    catch { throw new HttpError(422, 'That PDF couldn’t be read. It may be damaged or password-protected.'); }
  } else if (e === 'docx') {
    const mammoth = await import('mammoth');
    try { text = (await mammoth.extractRawText({ buffer: buf })).value; }
    catch { throw new HttpError(422, 'That Word file couldn’t be read. Save it again as .docx or PDF.'); }
  } else if (e === 'doc') {
    throw new HttpError(415, 'Older .doc files can’t be read. Save the resume as PDF or .docx, or paste the text.');
  } else if (e === 'rtf') {
    text = buf.toString('utf8').replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '');
  } else if (e === 'txt' || e === '') {
    text = buf.toString('utf8');
  } else {
    throw new HttpError(415, 'Upload a PDF, Word (.docx) or text file.');
  }
  text = text.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.replace(/\s/g, '').length < 40) throw new HttpError(422, 'No text found in that file. If it’s a scanned image, paste the resume text instead.');
  return text;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin\.com|github\.com)\/\S+/gi;
const STREET = /^.*\b\d{1,6}\s+[A-Za-z0-9.' ]+\b(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Pkwy|Cir|Ter|Apt|Suite)\b.*$/gim;
const NOT_A_NAME = /\b(resume|résumé|curriculum|vitae|cv|profile|summary|objective|experience|education|skills|contact|references|phone|email)\b/i;

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

/** Name, email and phone, found locally so they never have to be sent to the AI model. */
export function extractContact(text: string) {
  const email = text.match(EMAIL)?.[0]?.toLowerCase() ?? null;
  const phoneRaw = text.match(PHONE)?.[0] ?? null;
  const d = phoneRaw?.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') ?? '';
  const phone = d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
  let name: string | null = null;
  for (const raw of text.split('\n').slice(0, 8)) {
    const line = raw.replace(EMAIL, '').replace(PHONE, '').replace(/[|•·,]+/g, ' ').trim();
    if (!line || NOT_A_NAME.test(line) || /\d/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every((w) => /^\p{Lu}[\p{L}.'-]*$/u.test(w) || /^\p{Lu}{2,}$/u.test(w))) { name = titleCase(line); break; }
  }
  return { name, email, phone };
}

/** The resume with contact details, links, street addresses and the person's name removed. */
export function redactResume(text: string, name: string | null) {
  let out = text.replace(EMAIL, '[email]').replace(URL_RE, '[link]').replace(PHONE, '[phone]').replace(STREET, '[address]');
  if (name) {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc(name), 'gi'), '[name]');
    for (const part of name.split(' ').filter((p) => p.length > 2)) out = out.replace(new RegExp(`\\b${esc(part)}\\b`, 'gi'), '[name]');
  }
  return out;
}

export type ParsedProfile = {
  name: string | null; email: string | null; phone: string | null; title: string | null; location: string | null;
  sector: string | null; yearsExp: number | null; skills: string[]; certs: string[]; summary: string | null;
};

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const list = (v: unknown, n: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, n) : []);

/** Combines the locally found contact details with the model's answer, keeping only well-formed values. */
export function cleanProfile(ai: Record<string, unknown>, contact: ReturnType<typeof extractContact>): ParsedProfile {
  const years = Number(ai.yearsExp);
  const loc = str(ai.location, 120);
  return {
    ...contact,
    title: str(ai.title, 120), location: loc && !/\[(address|name)\]/.test(loc) ? loc : null,
    sector: typeof ai.sector === 'string' && SECTORS.includes(ai.sector) ? ai.sector : null,
    yearsExp: Number.isFinite(years) && years >= 0 && years <= 60 ? Math.round(years) : null,
    skills: list(ai.skills, 15), certs: list(ai.certs, 20),
    summary: str(ai.summary, 800)?.replace(/\[name\]/gi, 'The candidate') ?? null,
  };
}

export const resumePrompt = (redacted: string) => `Extract a candidate profile from this resume for a staffing agency ATS. Contact details and the person's name have been removed and replaced with [name], [email], [phone], [address] and [link]; do not try to recover them.
Return JSON with keys: title (most recent job title), location ("City, ST" if stated), sector (exactly one of ${JSON.stringify(SECTORS)}), yearsExp (total years of work experience as a number), skills (array of up to 15 short skills), certs (array of licenses and certifications), summary (2-3 sentence recruiter summary written without names or pronouns about gender).
Use "" or [] when unknown. Do not include or infer age, date of birth, graduation years as age, photos, marital status, nationality, religion, race, gender, disability or any other protected characteristic.
RESUME:
${redacted.slice(0, 30000)}`;
