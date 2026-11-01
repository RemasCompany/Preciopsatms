// Clinical skills checklists: a nurse or aide rates their own experience with each skill for a specialty. Facilities ask
// for one with every submittal, usually no more than a year old. Pure (shared by the UI and server; tested).

export const RATINGS = [
  { value: 1, label: 'No experience' },
  { value: 2, label: 'Limited — need review' },
  { value: 3, label: 'Competent — do it independently' },
  { value: 4, label: 'Proficient — could teach it' },
] as const;
export const VALID_MONTHS = 12;

type Spec = { title: string; sections: { title: string; items: string[] }[] };

const GENERAL = { title: 'General', items: ['Admission, transfer and discharge', 'Patient and family education', 'Electronic health record charting', 'Fall and pressure injury prevention', 'Restraint and seclusion policies', 'Infection control and isolation precautions'] };
const MEDS = { title: 'Medications and IV therapy', items: ['Medication administration (PO, IM, SubQ, IV push)', 'IV insertion and site care', 'IV pumps and PCA pumps', 'Blood product administration', 'Central line care (PICC, port, CVC)', 'High-alert medications (insulin, heparin, opioids)'] };

export const SKILLS_CHECKLISTS: Record<string, Spec> = {
  medsurg: { title: 'Medical-Surgical RN', sections: [GENERAL, MEDS,
    { title: 'Assessment and care', items: ['Head-to-toe assessment', 'Post-operative care', 'Wound care and dressing changes', 'Wound vacs (negative pressure)', 'Chest tubes', 'NG and feeding tubes', 'Ostomy care', 'Diabetic management and glucose monitoring', 'Pain assessment and management', 'Sepsis recognition and bundle'] },
    { title: 'Patient populations', items: ['Adult', 'Geriatric', 'Bariatric', 'Orthopedic', 'Oncology', 'Renal'] }] },
  tele: { title: 'Telemetry / Step-down RN', sections: [GENERAL, MEDS,
    { title: 'Cardiac', items: ['12-lead ECG placement', 'Rhythm interpretation', 'Cardiac drips (amiodarone, diltiazem, heparin, nitroglycerin)', 'Post-cardiac catheterization care', 'Pacemaker and ICD care', 'Chest pain protocol', 'Cardioversion assist', 'Heart failure management'] },
    { title: 'Respiratory', items: ['BiPAP and CPAP', 'High-flow nasal cannula', 'Tracheostomy care', 'Arterial blood gas interpretation'] }] },
  icu: { title: 'Intensive Care (ICU) RN', sections: [GENERAL, MEDS,
    { title: 'Hemodynamics', items: ['Arterial lines', 'Central venous pressure monitoring', 'Pulmonary artery (Swan-Ganz) catheters', 'Vasoactive drips (norepinephrine, vasopressin, dopamine)', 'Intra-aortic balloon pump', 'Targeted temperature management'] },
    { title: 'Respiratory', items: ['Ventilator management', 'Ventilator weaning', 'Prone positioning', 'Arterial blood gas interpretation', 'Tracheostomy care'] },
    { title: 'Neuro and renal', items: ['Sedation and paralytics (RASS, train of four)', 'ICP and EVD monitoring', 'NIH stroke scale', 'CRRT (continuous dialysis)', 'Massive transfusion protocol'] }] },
  er: { title: 'Emergency Department RN', sections: [GENERAL, MEDS,
    { title: 'Emergency care', items: ['ESI triage', 'Trauma assessment and resuscitation', 'Stroke alert / tPA administration', 'STEMI alert', 'Sepsis bundle', 'Rapid sequence intubation assist', 'Conscious sedation', 'Splinting and wound repair assist', 'Behavioral health and psychiatric holds', 'Sexual assault and abuse reporting'] },
    { title: 'Patient populations', items: ['Adult', 'Pediatric', 'Geriatric', 'Obstetric emergencies', 'Trauma level I/II'] }] },
  ld: { title: 'Labor & Delivery RN', sections: [GENERAL, MEDS,
    { title: 'Antepartum and labor', items: ['Electronic fetal monitoring interpretation', 'Internal monitoring (FSE, IUPC)', 'Oxytocin induction and augmentation', 'Magnesium sulfate administration', 'Epidural care', 'Cervical exams', 'Preeclampsia management'] },
    { title: 'Delivery and recovery', items: ['Vaginal delivery assist', 'Cesarean section circulating / scrub', 'Postpartum hemorrhage management', 'Newborn assessment and resuscitation (NRP)', 'Breastfeeding support', 'Postpartum recovery'] }] },
  or: { title: 'Operating Room RN', sections: [GENERAL,
    { title: 'Perioperative', items: ['Circulating', 'Scrubbing', 'Surgical counts and time-out', 'Sterile technique and field', 'Patient positioning', 'Specimen handling', 'Electrosurgery and laser safety', 'Malignant hyperthermia response'] },
    { title: 'Services', items: ['General', 'Orthopedic', 'Cardiovascular', 'Neurosurgery', 'Robotics', 'OB / GYN', 'Urology', 'ENT'] }] },
  cna: { title: 'Certified Nursing Assistant (CNA)', sections: [
    { title: 'Personal care', items: ['Bathing and oral care', 'Dressing and grooming', 'Toileting and incontinence care', 'Feeding assistance', 'Catheter care', 'Skin care and turning'] },
    { title: 'Mobility and safety', items: ['Transfers (gait belt, mechanical lift)', 'Ambulation with assistive devices', 'Range of motion', 'Fall prevention', 'Restraint alternatives'] },
    { title: 'Observation and reporting', items: ['Vital signs', 'Intake and output', 'Weights and heights', 'Blood glucose checks (where allowed)', 'Reporting changes in condition', 'Post-mortem care'] },
    { title: 'Settings', items: ['Hospital', 'Skilled nursing / long-term care', 'Memory care', 'Home health'] }] },
  lpn: { title: 'Licensed Practical / Vocational Nurse (LPN/LVN)', sections: [GENERAL,
    { title: 'Nursing care', items: ['Medication pass (PO, IM, SubQ)', 'IV therapy (within state scope)', 'Wound care', 'Tracheostomy care and suctioning', 'Gastrostomy and tube feedings', 'Catheter insertion', 'Diabetic care and insulin', 'Data collection and reporting'] },
    { title: 'Settings', items: ['Skilled nursing / long-term care', 'Rehabilitation', 'Hospital', 'Clinic', 'Home health', 'Corrections'] }] },
};
export const CHECKLIST_KEYS = Object.keys(SKILLS_CHECKLISTS);

/** Stable id for an item: section and item index, e.g. "2.4". */
export const itemKey = (s: number, i: number) => `${s}.${i}`;
export const itemCount = (key: string) => SKILLS_CHECKLISTS[key]?.sections.reduce((n, s) => n + s.items.length, 0) ?? 0;

/** Every item rated 1–4, nothing extra. Returns the clean answers or the first problem. */
export function checkAnswers(key: string, answers: Record<string, unknown>): { ok: true; answers: Record<string, number> } | { ok: false; error: string } {
  const spec = SKILLS_CHECKLISTS[key];
  if (!spec) return { ok: false, error: 'That checklist no longer exists.' };
  const out: Record<string, number> = {};
  for (const [s, sec] of spec.sections.entries()) for (const [i, item] of sec.items.entries()) {
    const v = answers[itemKey(s, i)];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 4) return { ok: false, error: `Rate “${item}” (${sec.title}).` };
    out[itemKey(s, i)] = v;
  }
  return { ok: true, answers: out };
}

/** Per-section averages and the skills rated 1–2 (where a facility should plan orientation). */
export function summarize(key: string, answers: Record<string, number>) {
  const spec = SKILLS_CHECKLISTS[key];
  if (!spec) return { sections: [], needsSupport: [], average: null as number | null };
  const all: number[] = [];
  const sections = spec.sections.map((sec, s) => {
    const vals = sec.items.map((_, i) => answers[itemKey(s, i)]).filter((v): v is number => typeof v === 'number');
    all.push(...vals);
    return { title: sec.title, average: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null, items: sec.items.map((item, i) => ({ item, rating: answers[itemKey(s, i)] ?? null })) };
  });
  const needsSupport = sections.flatMap((sec) => sec.items.filter((x) => x.rating !== null && x.rating <= 2).map((x) => `${sec.title}: ${x.item}`));
  return { sections, needsSupport, average: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null };
}
