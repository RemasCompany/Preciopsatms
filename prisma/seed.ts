import { PrismaClient, type Stage } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db = new PrismaClient();

// Demo data for local development and sales demos. Dates are relative to today so the demo always looks current.
// Safe to run more than once: the sample records are only added the first time.
const DAY = 864e5;
const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const days = (n: number) => new Date(today.getTime() + n * DAY);
const monthStart = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
const monday = days(-((today.getUTCDay() + 6) % 7)); // this week's Monday
const weekDay = (i: number, week = 0) => new Date(monday.getTime() + (week * 7 + i) * DAY);
const lastSunday = new Date(monday.getTime() - DAY);

async function main() {
  const org = await db.organization.upsert({ where: { slug: 'demo-staffing' }, update: {}, create: {
    name: 'Demo Staffing, LLC', shortName: 'Demo Staffing', slug: 'demo-staffing', ownerName: 'Demo Owner', ownerTitle: 'President', city: 'Orlando, FL',
    services: 'light industrial, logistics and healthcare', plan: 'growth', subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 14 * DAY), applyEmail: 'jobs@example.com' } });
  const hash = await bcrypt.hash('change-me-please', 12);
  const owner = await db.user.upsert({ where: { email: 'owner@example.com' }, update: {}, create: { email: 'owner@example.com', name: 'Demo Owner', passwordHash: hash } });
  const rep = await db.user.upsert({ where: { email: 'sam@example.com' }, update: {}, create: { email: 'sam@example.com', name: 'Sam Rivera', passwordHash: hash } });
  await db.membership.upsert({ where: { userId_organizationId: { userId: owner.id, organizationId: org.id } }, update: {}, create: { userId: owner.id, organizationId: org.id, role: 'OWNER' } });
  await db.membership.upsert({ where: { userId_organizationId: { userId: rep.id, organizationId: org.id } }, update: {}, create: { userId: rep.id, organizationId: org.id, role: 'RECRUITER' } });

  if (await db.client.count({ where: { organizationId: org.id } })) {
    console.log('Demo data is already there. Sign in as owner@example.com / change-me-please');
    return;
  }
  // All or nothing: a failure part-way never leaves a half-filled demo behind.
  await db.$transaction(async (tx) => {
    const o = { organizationId: org.id };

    // ---- clients, contacts, jobs ----
    const harbor = await tx.client.create({ data: { ...o, name: 'Harbor Point Distribution', industry: 'Warehouse', city: 'Orlando, FL', markupPct: 45, msaSignedAt: days(-200) } });
    const stmary = await tx.client.create({ data: { ...o, name: 'St. Mary’s Medical Center', industry: 'Healthcare', city: 'Orlando, FL', markupPct: 38, msaSignedAt: days(-120), paymentTerms: 'Net 45' } });
    const sunbelt = await tx.client.create({ data: { ...o, name: 'Sunbelt Foods', industry: 'Manufacturing', city: 'Kissimmee, FL', markupPct: 42 } });
    const lakeside = await tx.client.create({ data: { ...o, name: 'Lakeside Senior Living', industry: 'Healthcare', city: 'Winter Park, FL', status: 'Prospect' } });
    await tx.contact.createMany({ data: [
      { ...o, clientId: harbor.id, name: 'Rita Alvarez', title: 'Warehouse Manager', email: 'rita@harborpoint.example', phone: '4075550110' },
      { ...o, clientId: stmary.id, name: 'Dana Whitfield', title: 'Director of Nursing', email: 'dwhitfield@stmarys.example', phone: '4075550120' },
      { ...o, clientId: sunbelt.id, name: 'Marcus Lee', title: 'Plant HR Lead', email: 'mlee@sunbelt.example' },
      { ...o, clientId: lakeside.id, name: 'Karen Obi', title: 'Executive Director', email: 'kobi@lakeside.example' },
    ] });
    const job = (data: Record<string, unknown>) => tx.job.create({ data: { ...o, location: 'Orlando, FL', ...data } as never });
    const forklift = await job({ clientId: harbor.id, title: 'Forklift Operator — 2nd shift', type: 'TEMP', openings: 4, payRate: 18.5, billRate: 27, hot: true, sector: 'Warehouse', skills: ['Sit-down forklift', 'RF scanner'], description: 'Load and unload trailers, put-away and cycle counts on 2nd shift (3 PM – 11:30 PM). Forklift certification preferred; we train on RF scanners. Steady weekly hours with overtime available during peak season.' });
    const rn = await job({ clientId: stmary.id, title: 'Registered Nurse — ICU', type: 'CONTRACT', openings: 3, payRate: 58, billRate: 82, hot: true, sector: 'Healthcare', skills: ['ICU', 'BLS', 'ACLS', 'Epic'], description: '13-week ICU contract, 3×12 hour shifts. Active Florida or compact RN license, BLS and ACLS required, and at least two years of recent ICU experience. Day and night rotations available.' });
    const cna = await job({ clientId: stmary.id, title: 'Certified Nursing Assistant', type: 'PER_DIEM', openings: 5, payRate: 19, billRate: 28, sector: 'Healthcare', skills: ['Patient care', 'BLS'], description: 'Per diem CNA shifts on med-surg and telemetry units. Florida CNA certification and BLS required. Pick up day, evening or night shifts that fit your schedule.' });
    const cook = await job({ clientId: sunbelt.id, title: 'Line Cook', location: 'Kissimmee, FL', type: 'CONTRACT', openings: 2, payRate: 17, billRate: 24.5, sector: 'Manufacturing', skills: ['Food safety', 'Prep'], description: 'Prep and line cook for a production kitchen. ServSafe food handler card required. Early shift, 6 AM – 2:30 PM, Monday to Friday.' });
    await job({ clientId: harbor.id, title: 'Operations Supervisor', type: 'DIRECT_HIRE', openings: 1, payRate: 32, billRate: 0, sector: 'Warehouse', skills: ['Team lead', 'WMS'], description: 'Direct-hire supervisor for a 60-person distribution center. Five years of warehouse leadership and WMS experience.' });
  
    // ---- candidates and the pipeline ----
    const cand = (data: Record<string, unknown>) => tx.candidate.create({ data: { ...o, location: 'Orlando, FL', availability: 'Immediately', source: 'Job board', ...data } as never });
    const maria = await cand({ name: 'Maria Lopez', title: 'ICU Registered Nurse', email: 'maria.lopez@example.com', phone: '4075550201', sector: 'Healthcare', yearsExp: 7, desiredRate: 55, skills: ['ICU', 'Epic', 'Ventilators'], certs: ['RN', 'BLS', 'ACLS'] });
    const james = await cand({ name: 'James Carter', title: 'Forklift Operator', email: 'james.carter@example.com', phone: '4075550202', sector: 'Warehouse', yearsExp: 5, desiredRate: 18, skills: ['Sit-down forklift', 'Reach truck'] });
    const tom = await cand({ name: 'Tom Nguyen', title: 'Warehouse Associate', email: 'tom.nguyen@example.com', phone: '4075550203', sector: 'Warehouse', yearsExp: 3, desiredRate: 17.5, skills: ['RF scanner', 'Pick and pack'] });
    const aisha = await cand({ name: 'Aisha Khan', title: 'Certified Nursing Assistant', email: 'aisha.khan@example.com', phone: '4075550204', sector: 'Healthcare', yearsExp: 4, desiredRate: 18, skills: ['Patient care', 'Vitals'], certs: ['CNA', 'BLS'] });
    const luis = await cand({ name: 'Luis Ortega', title: 'Line Cook', email: 'luis.ortega@example.com', phone: '4075550205', sector: 'Manufacturing', yearsExp: 6, desiredRate: 16.5, skills: ['Prep', 'Grill'], source: 'Referral' });
    const priya = await cand({ name: 'Priya Shah', title: 'Registered Nurse', email: 'priya.shah@example.com', phone: '4075550206', sector: 'Healthcare', yearsExp: 3, desiredRate: 52, skills: ['Med-surg', 'Telemetry'], certs: ['RN', 'BLS'], source: 'LinkedIn' });
    const derek = await cand({ name: 'Derek Brooks', title: 'Material Handler', email: 'derek.brooks@example.com', sector: 'Warehouse', yearsExp: 1, desiredRate: 16, availability: '2 weeks' });
    const nina = await cand({ name: 'Nina Petrova', title: 'Travel ICU Nurse', email: 'nina.petrova@example.com', phone: '4075550208', sector: 'Healthcare', yearsExp: 10, desiredRate: 62, skills: ['ICU', 'CRRT'], certs: ['RN', 'ACLS', 'CCRN'], source: 'Careers page' });
    const app = (candidateId: string, jobId: string, stage: Stage, ago = 3, extra: Record<string, unknown> = {}) =>
      tx.application.create({ data: { ...o, candidateId, jobId, stage, maxStage: stage === 'REJECTED' ? 'SCREENED' : stage, stageChangedAt: days(-ago), ...extra } as never }).then((a) => a.id);
    const aMaria = await app(maria.id, rn.id, 'PLACED', 20);
    const aJames = await app(james.id, forklift.id, 'PLACED', 40);
    const aTom = await app(tom.id, forklift.id, 'PLACED', 35);
    const aAisha = await app(aisha.id, cna.id, 'PLACED', 25);
    const aLuis = await app(luis.id, cook.id, 'PLACED', 50);
    await app(priya.id, rn.id, 'INTERVIEW', 2, { matchScore: 81 });
    await app(nina.id, rn.id, 'SUBMITTED', 1, { matchScore: 92 });
    await app(derek.id, forklift.id, 'SCREENED', 4);
    await app(priya.id, cna.id, 'REJECTED', 6, { rejectionReason: 'Pursuing other opportunity' });
    await tx.candidate.updateMany({ where: { id: { in: [maria.id, james.id, tom.id, aisha.id, luis.id] } }, data: { status: 'On assignment' } });
  
    // ---- credentials (a mix of current, expiring, expired and unverified) ----
    const cred = (candidateId: string, type: string, expires: number | null, extra: Record<string, unknown> = {}) => tx.credential.create({ data: {
      ...o, candidateId, type, expiresAt: expires === null ? null : days(expires), issuedAt: expires === null ? null : days(expires - 730),
      verifiedAt: days(-30), verifiedById: owner.id, verifyMethod: 'Original document reviewed', ...extra } as never });
    await cred(maria.id, 'RN license', 420, { number: 'RN9284417', state: 'FL', verifyMethod: 'Nursys QuickConfirm', verifyNote: 'Active, no discipline' });
    await cred(maria.id, 'BLS', 18, { verifyMethod: 'Issuing organization (e.g. AHA eCard)' });
    await cred(maria.id, 'ACLS', 200, { verifyMethod: 'Issuing organization (e.g. AHA eCard)' });
    await cred(maria.id, 'TB test', -4, { verifyMethod: 'Lab or vendor report' });
    await cred(aisha.id, 'CNA certification', 300, { number: 'CNA55120', state: 'FL', verifiedAt: null, verifiedById: null, verifyMethod: null });
    await cred(aisha.id, 'BLS', 6);
    await cred(priya.id, 'RN license', 500, { number: 'RN7710342', state: 'FL' });
    await cred(nina.id, 'Compact (multistate) nursing license', 55, { number: 'RN5530021', state: 'TX', verifiedAt: null, verifiedById: null, verifyMethod: null });
    await cred(james.id, 'Drug screen', 150, { verifyMethod: 'Lab or vendor report' });
    await cred(james.id, 'Background check', 150, { verifyMethod: 'Lab or vendor report' });
  
    // ---- this week's schedule (sent, confirmed, declined, drafts) and last week's timesheets ----
    const sent = { notified: true, notifiedAt: days(-3) };
    const shift = (applicationId: string, date: Date, start: string, end: string, extra: Record<string, unknown> = {}) =>
      tx.shift.create({ data: { ...o, applicationId, date, start, end, breakMinutes: 30, ...extra } as never });
    for (const i of [0, 1, 3]) await shift(aMaria, weekDay(i), '07:00', '19:00', { ...sent, unit: 'ICU', response: i < 3 ? 'CONFIRMED' : 'PENDING', respondedAt: days(-2) });
    await shift(aMaria, weekDay(5), '07:00', '19:00', { unit: 'ICU' });
    for (const i of [0, 1, 2, 3, 4]) await shift(aJames, weekDay(i), '15:00', '23:30', { ...sent, unit: 'Dock B', response: 'CONFIRMED', respondedAt: days(-2) });
    for (const i of [0, 2, 4]) await shift(aTom, weekDay(i), '15:00', '23:30', { ...sent, unit: 'Dock A' });
    await shift(aAisha, weekDay(1), '19:00', '07:00', { ...sent, unit: 'Telemetry', response: 'DECLINED', declineReason: 'Childcare fell through', respondedAt: days(-1) });
    await shift(aAisha, weekDay(4), '19:00', '07:00', { unit: 'Telemetry' });
    for (const i of [0, 1, 2, 3, 4]) await shift(aLuis, weekDay(i), '06:00', '14:30', { ...sent, response: 'CONFIRMED', respondedAt: days(-3) });
    const ts = (applicationId: string, reg: number, ot: number, pay: number, bill: number, status: 'DRAFT' | 'APPROVED') =>
      tx.timesheet.create({ data: { ...o, applicationId, weekEnding: lastSunday, regularHours: reg, overtimeHours: ot, payRate: pay, billRate: bill, status, ...(status === 'APPROVED' ? { approvedAt: days(-1), approvedById: owner.id } : {}) } });
    await ts(aMaria, 36, 0, 58, 82, 'APPROVED');
    await ts(aJames, 40, 4, 18.5, 27, 'APPROVED');
    await ts(aTom, 32, 0, 18.5, 27, 'DRAFT');
    await ts(aLuis, 40, 0, 17, 24.5, 'DRAFT');
  
    // ---- sales: deals over six months, leads, monthly targets ----
    const deal = (title: string, clientId: string | null, value: number, stage: string, ownerId: string, created: number, closed: number | null, extra: Record<string, unknown> = {}) =>
      tx.deal.create({ data: { ...o, title, clientId, value, stage, ownerId, createdAt: days(created), closedAt: closed === null ? null : days(closed), stageChangedAt: days(closed ?? Math.min(-2, created + 10)), ...extra } });
    await deal('Harbor Point peak season', harbor.id, 120000, 'Won', owner.id, -170, -140);
    await deal('St. Mary’s ICU contract', stmary.id, 210000, 'Won', rep.id, -150, -110);
    await deal('Sunbelt kitchen staff', sunbelt.id, 48000, 'Won', owner.id, -120, -80);
    await deal('St. Mary’s CNA pool', stmary.id, 65000, 'Won', rep.id, -90, -50);
    await deal('Harbor Point 2nd shift', harbor.id, 72000, 'Won', owner.id, -45, -20);
    await deal('Sunbelt sanitation crew', sunbelt.id, 30000, 'Won', rep.id, -30, -8);
    await deal('Metro hotel banquet staff', null, 45000, 'Lost', rep.id, -60, -15);
    await deal('Lakeside caregivers', lakeside.id, 90000, 'Negotiation', rep.id, -40, null, { closeDate: days(25), stageChangedAt: days(-21) });
    await deal('St. Mary’s travel nurses (Q1)', stmary.id, 160000, 'Proposal', owner.id, -20, null, { closeDate: days(-3) });
    await deal('Harbor Point cycle counters', harbor.id, 24000, 'Qualified', owner.id, -6, null, { closeDate: days(40) });
    await deal('Sunbelt QA technicians', sunbelt.id, 36000, 'Prospect', rep.id, -3, null);
    const lead = (company: string, status: string, ownerId: string, created: number, extra: Record<string, unknown> = {}) =>
      tx.lead.create({ data: { ...o, company, status, ownerId, createdAt: days(created), convertedAt: status === 'Converted' ? days(created + 7) : null, city: 'Orlando, FL', ...extra } });
    await lead('Orange County Health', 'Qualified', rep.id, -12, { contact: 'Leah Grant', role: 'HR Director', industry: 'Healthcare', size: '1000+', source: 'Referral', score: 84, nextStepAt: days(1) });
    await lead('Brightway Logistics', 'Contacted', owner.id, -9, { contact: 'Omar Haddad', role: 'Operations Manager', industry: 'Logistics', size: '201-1000', source: 'LinkedIn', score: 71, nextStepAt: days(-1) });
    await lead('Citrus Packaging Co.', 'New', owner.id, -4, { industry: 'Manufacturing', size: '51-200', source: 'Website' });
    await lead('Palm Grove Rehab', 'New', rep.id, -2, { contact: 'Ivy Chen', industry: 'Healthcare', size: '51-200', source: 'Cold outreach' });
    await lead('Gateway Cold Storage', 'Disqualified', rep.id, -20, { industry: 'Warehouse', source: 'Event', notes: 'Uses an in-house staffing team.' });
    await lead('Lakeside Senior Living', 'Converted', rep.id, -48, { contact: 'Karen Obi', industry: 'Healthcare', source: 'Referral', score: 90 });
    for (let m = -5; m <= 1; m++) {
      await tx.salesTarget.createMany({ data: [
        { ...o, userId: owner.id, month: monthStart(m), amount: 50000 },
        { ...o, userId: rep.id, month: monthStart(m), amount: m >= -1 ? 60000 : 50000 },
      ] });
    }
  
    // ---- vendors and tasks ----
    await tx.vendor.create({ data: { ...o, name: 'SafeScreen Background Checks', category: 'Background & drug screening', status: 'Approved', contact: 'Paul Reyes', email: 'paul@safescreen.example', feePct: 0, rating: 4.5, coiExpiresAt: days(240), w9ReceivedAt: days(-300), agreementExpiresAt: days(180) } });
    await tx.vendor.create({ data: { ...o, name: 'CareBridge Nurse Partners', category: 'Sub-vendor / supplier', status: 'Approved', contact: 'Tina Moss', email: 'tina@carebridge.example', sectors: ['Healthcare'], feePct: 35, rating: 4, coiExpiresAt: days(12), w9ReceivedAt: days(-200), agreementExpiresAt: days(90) } });
    await tx.task.createMany({ data: [
      { ...o, title: 'Call Dana about Q1 travel nurse proposal', dueAt: days(0), priority: 'High', related: 'St. Mary’s Medical Center', assigneeId: owner.id },
      { ...o, title: 'Get Maria’s renewed TB test', dueAt: days(-1), priority: 'High', related: 'Maria Lopez', assigneeId: owner.id },
      { ...o, title: 'Approve last week’s timesheets', dueAt: days(1), related: 'Payroll', assigneeId: owner.id },
      { ...o, title: 'Send CareBridge a COI renewal request', dueAt: days(5), related: 'CareBridge Nurse Partners', assigneeId: rep.id },
    ] });
    await tx.activity.createMany({ data: [
      { ...o, text: 'Nina Petrova applied for Registered Nurse — ICU on the careers page', createdAt: days(-1) },
      { ...o, text: 'Aisha Khan can’t make a Telemetry shift: “Childcare fell through”', createdAt: days(-1) },
      { ...o, text: 'Deal “Sunbelt sanitation crew” moved to Won', actorId: rep.id, createdAt: days(-8) },
    ] });
  }, { timeout: 120_000 });

  console.log('Seeded the demo company. Sign in as owner@example.com (or sam@example.com, a recruiter) / change-me-please');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
