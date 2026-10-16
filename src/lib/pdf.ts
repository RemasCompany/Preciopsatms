import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const M = 56, W = 612, H = 792, LH = 14.5;

function wrap(text: string, font: PDFFont, size: number, max: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
// Standard fonts are WinAnsi only; strip anything else so PDF generation never throws.
const ansi = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');

type SignedDoc = {
  id: string; title: string; body: string; signerName: string; signerSignature: string | null; signedAt: Date | null;
  signerIp: string | null; bodySha256: string | null; counterName?: string | null; counterSignature?: string | null; counterSignedAt?: Date | null;
  audit: unknown; organization: { name: string };
};

export async function renderSignedPdf(doc: SignedDoc) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([W, H]); let y = H - 64;
  const ensure = (need: number) => { if (y - need < 60) { page = pdf.addPage([W, H]); y = H - 64; } };
  page.drawText(ansi(doc.title), { x: M, y, size: 15, font: bold }); y -= 28;
  for (const l of wrap(ansi(doc.body), font, 10.5, W - 2 * M)) { ensure(LH); page.drawText(l, { x: M, y, size: 10.5, font }); y -= LH; }

  const block = async (label: string, name?: string | null, sig?: string | null, at?: Date | null) => {
    ensure(110); y -= 24; page.drawText(ansi(label), { x: M, y, size: 11, font: bold }); y -= 8;
    if (sig) {
      const img = await pdf.embedPng(Buffer.from(sig.split(',')[1], 'base64'));
      const h = 54, w = Math.min(200, (img.width / img.height) * h);
      page.drawImage(img, { x: M, y: y - h, width: w, height: h }); y -= h + 14;
      page.drawText(ansi(`${name} - signed electronically ${at?.toISOString()}`), { x: M, y, size: 9.5, font });
    } else { y -= 44; page.drawLine({ start: { x: M, y }, end: { x: 300, y }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) }); }
  };
  await block(`Signer: ${doc.signerName}`, doc.signerName, doc.signerSignature, doc.signedAt);
  await block(doc.organization.name, doc.counterName, doc.counterSignature, doc.counterSignedAt);

  page = pdf.addPage([W, H]); y = H - 64;
  page.drawText('Electronic signature audit trail', { x: M, y, size: 13, font: bold }); y -= 22;
  const lines = [`Document ID: ${doc.id}`, `SHA-256 of signed text: ${doc.bodySha256 ?? 'n/a'}`, `Signer IP: ${doc.signerIp ?? 'n/a'}`,
    ...((doc.audit as { at: string; event: string; [k: string]: unknown }[]) ?? []).map((a) => `${a.at}  ${a.event}${a.name ? ` by ${a.name}` : ''}${a.to ? ` to ${a.to}` : ''}${a.ip ? ` from ${a.ip}` : ''}`)];
  for (const l of lines.flatMap((x) => wrap(ansi(x), font, 9.5, W - 2 * M))) { ensure(13); page.drawText(l, { x: M, y, size: 9.5, font }); y -= 13; }
  return pdf.save();
}

export type InvoicePdfInput = {
  number: string; company: string; city?: string | null; client: string; clientCity?: string | null; terms: string; weekEnding: string; due: string; period?: string;
  lines: { worker: string; position: string; week?: string | null; reg: number; ot: number; rate: number; amount: number; approvedBy?: string | null }[];
  // Everything below is optional so a quick weekly PDF still works with just the basics.
  issued?: string; poNumber?: string | null; status?: string;
  from?: { address?: string | null; phone?: string | null; email?: string | null; website?: string | null; taxId?: string | null };
  billTo?: { name?: string | null; address?: string | null };
  items?: { kind: string; description: string; qty: number; rate: number; amount: number }[];
  totals?: { subtotal: number; taxRatePct: number; tax: number; total: number; paid: number; balance: number };
  notes?: string | null; remit?: string | null; footer?: string | null; brandColor?: string | null; logo?: { bytes: Uint8Array; png: boolean } | null;
};

const hex = (c: string | null | undefined) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '');
  if (!m) return rgb(0.055, 0.478, 0.431);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND_LABEL: Record<string, string> = { expense: 'Expense', fee: 'Fee', discount: 'Discount' };

/**
 * A client invoice: letterhead, bill-to, PO and dates, hours by worker and week (with the client's sign-off), added
 * items, subtotal, tax, payments and balance, then notes and how to pay. Continues across pages with the header repeated.
 */
export async function renderInvoicePdf(inv: InvoicePdfInput) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hex(inv.brandColor), grey = rgb(0.38, 0.4, 0.45), line = rgb(0.85, 0.86, 0.89), soft = rgb(0.96, 0.97, 0.98);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (inv.logo) { try { logo = inv.logo.png ? await pdf.embedPng(inv.logo.bytes) : await pdf.embedJpg(inv.logo.bytes); } catch { logo = null; } }
  const pages: PDFPage[] = [];
  let page!: PDFPage, y = 0;
  const text = (t: string, x: number, yy: number, o: { f?: PDFFont; s?: number; c?: ReturnType<typeof rgb> } = {}) => page.drawText(ansi(t), { x, y: yy, size: o.s ?? 9.5, font: o.f ?? font, color: o.c ?? rgb(0.1, 0.12, 0.16) });
  const right = (t: string, x: number, yy: number, o: { f?: PDFFont; s?: number; c?: ReturnType<typeof rgb> } = {}) => { const f = o.f ?? font, s = o.s ?? 9.5; text(t, x - f.widthOfTextAtSize(ansi(t), s), yy, o); };
  const fit = (t: string, max: number, f = font, s = 9.5) => { let v = ansi(t); if (f.widthOfTextAtSize(v, s) <= max) return v; while (v.length > 3 && f.widthOfTextAtSize(`${v}...`, s) > max) v = v.slice(0, -1); return `${v.trimEnd()}...`; };
  const hr = (yy: number, x1 = M, x2 = W - M, c = line) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.7, color: c });

  const newPage = (first: boolean) => {
    page = pdf.addPage([W, H]); pages.push(page);
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: brand });
    y = H - 50;
    if (!first) { text(`${inv.company} - Invoice ${inv.number} (continued)`, M, y, { f: bold, s: 10 }); y -= 26; return; }
    let lx = M;
    if (logo) { const h = 40, w = Math.min(120, (logo.width / logo.height) * h); page.drawImage(logo, { x: M, y: y - h + 12, width: w, height: h }); lx = M + w + 12; }
    text(inv.company, lx, y, { f: bold, s: 16 });
    const from = [...(inv.from?.address ? inv.from.address.split('\n') : inv.city ? [inv.city] : []), [inv.from?.phone, inv.from?.email].filter(Boolean).join('  |  '), inv.from?.website ?? '', inv.from?.taxId ? `Tax ID: ${inv.from.taxId}` : ''].filter((x) => x && x.trim());
    from.slice(0, 6).forEach((l, i) => text(fit(l, 260), lx, y - 15 - i * 11.5, { s: 9, c: grey }));
    right(inv.status === 'VOID' ? 'INVOICE - VOID' : 'INVOICE', W - M, y, { f: bold, s: 20, c: inv.status === 'VOID' ? rgb(0.7, 0.15, 0.12) : brand });
    const meta: [string, string][] = [['Invoice #', inv.number], ...(inv.issued ? [['Issue date', inv.issued] as [string, string]] : []), ['Due date', inv.due], ['Terms', inv.terms],
      ...(inv.poNumber ? [['PO number', inv.poNumber] as [string, string]] : []), [inv.period ? 'Service period' : 'Week ending', inv.period ?? inv.weekEnding]];
    meta.forEach(([k, v], i) => { right(k, W - M - 130, y - 20 - i * 12.5, { s: 9, c: grey }); right(v, W - M, y - 20 - i * 12.5, { f: bold, s: 9 }); });
    y -= Math.max(28 + from.length * 11.5, 30 + meta.length * 12.5, logo ? 50 : 0) + 14;
    // Bill to, and the balance in a box
    text('BILL TO', M, y, { f: bold, s: 8.5, c: grey });
    const bt = [inv.client, ...(inv.billTo?.name ? [`Attn: ${inv.billTo.name}`] : []), ...((inv.billTo?.address ? inv.billTo.address.split('\n') : inv.clientCity ? [inv.clientCity] : []))].filter((x) => x.trim());
    bt.slice(0, 7).forEach((l, i) => text(fit(l, 280), M, y - 14 - i * 12, { f: i === 0 ? bold : font, s: i === 0 ? 10.5 : 9.5 }));
    const due = inv.totals ? inv.totals.balance : inv.lines.reduce((s, l) => s + l.amount, 0);
    page.drawRectangle({ x: W - M - 190, y: y - 50, width: 190, height: 56, color: soft, borderColor: line, borderWidth: 0.7 });
    text(inv.status === 'PAID' ? 'PAID IN FULL' : 'BALANCE DUE', W - M - 178, y - 10, { f: bold, s: 8.5, c: grey });
    text(money(due), W - M - 178, y - 32, { f: bold, s: 18, c: inv.status === 'PAID' ? rgb(0.1, 0.5, 0.3) : brand });
    if (inv.status !== 'PAID') text(`by ${inv.due}`, W - M - 178, y - 44, { s: 8.5, c: grey });
    y -= Math.max(30 + bt.length * 12, 64) + 12;
  };
  const ensure = (need: number) => { if (y - need < 70) { newPage(false); return true; } return false; };

  newPage(true);
  // Hours, grouped by worker
  const cols = { worker: M, pos: M + 4, week: 330, reg: 378, ot: 420, rate: 494, amt: W - M };
  const head = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: brand });
    const o = { f: bold, s: 8.5, c: rgb(1, 1, 1) };
    text('WORKER / POSITION', cols.worker + 6, y, o); right('WEEK ENDING', cols.week, y, o); right('REG HRS', cols.reg, y, o); right('OT HRS', cols.ot, y, o); right('BILL RATE', cols.rate, y, o); right('AMOUNT', cols.amt - 6, y, o);
    y -= 22;
  };
  if (inv.lines.length) {
    text('Services', M, y, { f: bold, s: 11 }); y -= 16; head();
    const byWorker = new Map<string, typeof inv.lines>();
    for (const l of inv.lines) byWorker.set(l.worker, [...(byWorker.get(l.worker) ?? []), l]);
    for (const [worker, ls] of byWorker) {
      if (ensure(18 + 15)) head();
      text(fit(worker, 260), cols.worker + 6, y, { f: bold, s: 9.5 }); y -= 13;
      for (const l of ls) {
        const need = l.approvedBy ? 25 : 14;
        if (ensure(need)) { head(); text(`${fit(worker, 250)} (cont.)`, cols.worker + 6, y, { f: bold }); y -= 13; }
        text(fit(l.position, 185), cols.pos + 10, y);
        if (l.week) right(l.week, cols.week, y);
        right(l.reg.toFixed(2), cols.reg, y); right(l.ot ? l.ot.toFixed(2) : '-', cols.ot, y);
        right(`${money(l.rate)}${l.ot ? ` / ${money(Math.round(l.rate * 150) / 100)}` : ''}`, cols.rate, y, { s: l.ot ? 8 : 9.5 });
        right(money(l.amount), cols.amt - 6, y);
        if (l.approvedBy) { y -= 11; text(fit(l.approvedBy, 300), cols.pos + 10, y, { s: 8, c: grey }); }
        y -= 14;
      }
      if (ls.length > 1) {
        const r = ls.reduce((s, l) => s + l.reg, 0), o = ls.reduce((s, l) => s + l.ot, 0), a = ls.reduce((s, l) => s + l.amount, 0);
        hr(y + 9, cols.week - 80, W - M);
        right(`${fit(worker, 120, font, 8.5)} total`, cols.week, y, { s: 8.5, c: grey }); right(r.toFixed(2), cols.reg, y, { f: bold, s: 9 }); right(o ? o.toFixed(2) : '-', cols.ot, y, { f: bold, s: 9 }); right(money(a), cols.amt - 6, y, { f: bold, s: 9 });
        y -= 14;
      }
      hr(y + 8); y -= 6;
    }
    const reg = inv.lines.reduce((s, l) => s + l.reg, 0), ot = inv.lines.reduce((s, l) => s + l.ot, 0);
    ensure(16);
    text(`${byWorker.size} worker${byWorker.size === 1 ? '' : 's'} - ${reg.toFixed(2)} regular hours, ${ot.toFixed(2)} overtime hours. Overtime bills at 1.5x the bill rate.`, M, y, { s: 8.5, c: grey }); y -= 22;
  }
  // Additional items
  if (inv.items?.length) {
    ensure(40); text('Additional items', M, y, { f: bold, s: 11 }); y -= 16;
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: soft });
    const o = { f: bold, s: 8.5, c: grey };
    text('DESCRIPTION', M + 6, y, o); right('QTY', cols.ot, y, o); right('RATE', cols.rate, y, o); right('AMOUNT', cols.amt - 6, y, o); y -= 22;
    for (const it of inv.items) {
      ensure(16);
      text(`${KIND_LABEL[it.kind] ?? 'Item'}:`, M + 6, y, { s: 8.5, c: grey }); text(fit(it.description, 260), M + 62, y);
      right(String(Number(it.qty.toFixed(2))), cols.ot, y); right(money(it.rate), cols.rate, y); right(money(it.amount), cols.amt - 6, y, { c: it.amount < 0 ? rgb(0.7, 0.15, 0.12) : undefined });
      y -= 15;
    }
    hr(y + 8); y -= 10;
  }
  // Totals
  const t = inv.totals ?? (() => { const s = inv.lines.reduce((a, l) => a + l.amount, 0); return { subtotal: s, taxRatePct: 0, tax: 0, total: s, paid: 0, balance: s }; })();
  const labor = inv.lines.reduce((s, l) => s + l.amount, 0);
  const rows: [string, string, boolean?][] = [
    ...(inv.items?.length ? [['Services', money(labor)] as [string, string]] : []),
    ...(inv.items?.filter((i) => i.amount > 0).length ? [['Additional items', money(inv.items.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0))] as [string, string]] : []),
    ...(inv.items?.filter((i) => i.amount < 0).length ? [['Discounts and credits', money(inv.items.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0))] as [string, string]] : []),
    ['Subtotal', money(t.subtotal)],
    ...(t.tax ? [[`Sales tax (${Number(t.taxRatePct.toFixed(3))}%)`, money(t.tax)] as [string, string]] : []),
    ['Total', money(t.total), true],
    ...(t.paid ? [['Payments received', money(-t.paid)] as [string, string]] : []),
    ...(t.paid ? [['Balance due', money(t.balance), true] as [string, string, boolean]] : []),
  ];
  // "How to pay" sits to the left of the totals, so a short invoice stays on one page.
  const remit = inv.remit ? wrap(ansi(inv.remit), font, 9, 250).slice(0, 12) : [];
  const height = Math.max(rows.length * 15 + 14, remit.length ? 18 + remit.length * 12 : 0);
  ensure(height);
  const top = y;
  if (remit.length) {
    text('How to pay', M, y, { f: bold, s: 9.5 });
    remit.forEach((l, i) => text(l, M, y - 14 - i * 12, { s: 9 }));
  }
  for (const [k, v, strong] of rows) {
    if (strong) { hr(y + 11, W - M - 220); }
    right(k, W - M - 100, y, { f: strong ? bold : font, s: strong ? 10.5 : 9.5, c: strong ? undefined : grey }); right(v, W - M - 6, y, { f: strong ? bold : font, s: strong ? 10.5 : 9.5 });
    y -= strong ? 18 : 14;
  }
  y = Math.min(y, top - (remit.length ? 18 + remit.length * 12 : 0)) - 10;
  // Notes
  const block = (title: string, body: string) => {
    const ls = wrap(ansi(body), font, 9, W - 2 * M - 20);
    ensure(24 + Math.min(ls.length, 12) * 12);
    text(title, M, y, { f: bold, s: 9.5 }); y -= 13;
    for (const l of ls.slice(0, 30)) { ensure(12); text(l, M, y, { s: 9 }); y -= 12; }
    y -= 8;
  };
  if (inv.notes) block('Notes', inv.notes);
  if (inv.status === 'VOID') block('Void', 'This invoice was voided and is not payable.');
  // Footer on every page
  pages.forEach((pg, i) => {
    const f = ansi(inv.footer || 'Thank you for your business.');
    pg.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.6, color: line });
    pg.drawText(fit(f, 380, font, 8.5), { x: M, y: 32, size: 8.5, font, color: grey });
    const pn = `Invoice ${inv.number} - page ${i + 1} of ${pages.length}`;
    pg.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 8.5), y: 32, size: 8.5, font, color: grey });
  });
  return pdf.save();
}

/**
 * Pay summaries for a payroll run, one page per worker: hours, earnings, reimbursements and deductions before taxes.
 * Taxes and net pay come from the payroll provider's official pay stub.
 */
export async function renderPaySummariesPdf(o: {
  company: string; city?: string | null; run: string; period: string; payDate: string; provider: string | null;
  workers: { name: string; payrollId: string | null;
    lines: { label: string; hours: number | null; rate: number | null; amount: number }[];
    adjustments: { label: string; amount: number; kind: 'earning' | 'reimbursement' | 'deduction' }[];
    gross: number; reimbursements: number; deductions: number }[];
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const $ = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  for (const w of o.workers) {
    let page = pdf.addPage([W, H]); let y = H - 64;
    const right = (t: string, x: number, yy: number, f = font, sz = 10) => page.drawText(ansi(t), { x: x - f.widthOfTextAtSize(ansi(t), sz), y: yy, size: sz, font: f });
    const text = (t: string, x: number, yy: number, f = font, sz = 10) => page.drawText(ansi(t), { x, y: yy, size: sz, font: f });
    text(o.company, M, y, bold, 16); if (o.city) text(o.city, M, y - 15);
    right('PAY SUMMARY', W - M, y, bold, 13);
    [`Run: ${o.run}`, `Pay period: ${o.period}`, `Pay date: ${o.payDate}`].forEach((t, i) => right(t, W - M, y - 18 - i * 13));
    y -= 84; text(w.name, M, y, bold, 12); if (w.payrollId) text(`Employee ID: ${w.payrollId}`, M, y - 14);
    y -= 40; const cols = [M, 380, 450, W - M];
    text('Earnings', cols[0], y, bold); right('Hours', cols[1], y, bold); right('Rate', cols[2], y, bold); right('Amount', cols[3], y, bold);
    y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6 }); y -= 16;
    const row = (label: string, hours: number | null, rate: number | null, amount: number, f = font) => {
      if (y < 110) { page = pdf.addPage([W, H]); y = H - 64; }
      // Trim to the column width so labels never run into the numbers.
      let t = ansi(label); const max = cols[1] - cols[0] - 60;
      if (f.widthOfTextAtSize(t, 10) > max) { while (t.length > 4 && f.widthOfTextAtSize(`${t}...`, 10) > max) t = t.slice(0, -1); t = `${t.trimEnd()}...`; }
      page.drawText(t, { x: cols[0], y, size: 10, font: f }); if (hours !== null) right(hours.toFixed(2), cols[1], y, f); if (rate !== null) right($(rate), cols[2], y, f); right($(amount), cols[3], y, f); y -= 17;
    };
    for (const l of w.lines) row(l.label, l.hours, l.rate, l.amount);
    for (const a of w.adjustments.filter((x) => x.kind === 'earning')) row(a.label, null, null, a.amount);
    y -= 2; page.drawLine({ start: { x: 330, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.6 });
    row('Gross pay (before taxes)', null, null, w.gross, bold);
    const reimb = w.adjustments.filter((x) => x.kind === 'reimbursement'), ded = w.adjustments.filter((x) => x.kind === 'deduction');
    if (reimb.length) { y -= 10; text('Reimbursements (not taxed)', M, y, bold); y -= 17; for (const a of reimb) row(a.label, null, null, a.amount); }
    if (ded.length) { y -= 10; text('Deductions (after tax)', M, y, bold); y -= 17; for (const a of ded) row(a.label, null, null, -a.amount); }
    const note = `This summary shows hours and earnings before taxes. Tax withholding and net pay are calculated by ${o.provider ?? 'our payroll provider'} and appear on your official pay stub. Questions? Contact ${o.company}.`;
    let ny = 70; for (const line of wrap(note, font, 9, W - 2 * M)) { page.drawText(ansi(line), { x: M, y: ny, size: 9, font, color: rgb(0.3, 0.3, 0.3) }); ny -= 12; }
  }
  if (!o.workers.length) pdf.addPage([W, H]);
  return pdf.save();
}

/** An operator certificate: name, training and evaluation dates, and who trained and evaluated them (what OSHA 1910.178(l)(6) asks for, used for every equipment type). */
export async function renderTrainingCertificate(c: {
  company: string; operator: string; course: string; certType: string; equipment: string; reason: string;
  quizPassed: string | null; quizScore: number | null; trainedAt: string; evaluatedAt: string; evaluator: string; evaluatorTitle: string; expiresAt: string;
  checklist: { item: string; pass: boolean }[]; id: string; heading: string; standard: string; footer: string;
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([W, H]);
  let y = H - 72;
  const center = (t: string, size: number, f = font) => { const s = ansi(t); page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f }); };
  center(c.company, 12); y -= 30;
  center(c.heading, 17, bold); y -= 22;
  center(c.standard, 10); y -= 40;
  center('This certifies that', 11); y -= 28;
  center(c.operator, 22, bold); y -= 28;
  center(`has been trained and evaluated as an operator of: ${c.certType}`, 11); y -= 42;
  const row = (label: string, value: string) => { page.drawText(ansi(label), { x: M, y, size: 10, font: bold }); for (const l of wrap(ansi(value), font, 10, W - M - 220)) { page.drawText(l, { x: 220, y, size: 10, font }); y -= 14; } y -= 4; };
  row('Training type', c.reason);
  row('Formal instruction', `${c.course}${c.quizPassed ? ` - completed ${c.quizPassed}${c.quizScore !== null ? ` (quiz ${c.quizScore}%)` : ''}` : ''}`);
  row('Practical training', c.trainedAt);
  row('Evaluation date', c.evaluatedAt);
  row('Trained and evaluated by', `${c.evaluator}, ${c.evaluatorTitle}`);
  row('Equipment evaluated on', c.equipment);
  row('Re-evaluate by', c.expiresAt);
  y -= 10;
  page.drawText('Practical evaluation', { x: M, y, size: 11, font: bold }); y -= 16;
  for (const x of c.checklist) for (const [i, l] of wrap(ansi(`${x.pass ? 'Pass' : 'Not passed'} - ${x.item}`), font, 9.5, W - 2 * M).entries()) { page.drawText(l, { x: M + (i ? 10 : 0), y, size: 9.5, font }); y -= 13; }
  y = Math.min(y - 30, 150);
  page.drawLine({ start: { x: M, y }, end: { x: 300, y }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Evaluator signature', { x: M, y: y - 12, size: 9, font });
  page.drawLine({ start: { x: 330, y }, end: { x: W - M, y }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Operator signature', { x: 330, y: y - 12, size: 9, font });
  const foot = ansi(`${c.footer} Record ${c.id}.`);
  let fy = 60;
  for (const l of wrap(foot, font, 8, W - 2 * M).reverse()) { page.drawText(l, { x: M, y: fy, size: 8, font, color: rgb(0.35, 0.35, 0.35) }); fy += 10; }
  return pdf.save();
}
