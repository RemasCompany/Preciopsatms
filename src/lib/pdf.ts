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

export async function renderInvoicePdf(inv: {
  number: string; company: string; city?: string | null; client: string; clientCity?: string | null; terms: string; weekEnding: string; due: string; period?: string;
  lines: { worker: string; position: string; reg: number; ot: number; rate: number; amount: number }[];
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([W, H]); let y = H - 64;
  const right = (t: string, x: number, yy: number, f = font, s = 10) => page.drawText(ansi(t), { x: x - f.widthOfTextAtSize(ansi(t), s), y: yy, size: s, font: f });
  page.drawText(ansi(inv.company), { x: M, y, size: 18, font: bold }); if (inv.city) page.drawText(ansi(inv.city), { x: M, y: y - 16, size: 10, font });
  right('INVOICE', W - M, y, bold, 16);
  [`Invoice #: ${inv.number}`, inv.period ? `Period: ${inv.period}` : `Week ending: ${inv.weekEnding}`, `Terms: ${inv.terms}`, `Due: ${inv.due}`].forEach((t, i) => right(t, W - M, y - 20 - i * 13));
  y -= 96; page.drawText('Bill to', { x: M, y, size: 10, font: bold }); page.drawText(ansi(inv.client), { x: M, y: y - 14, size: 10, font });
  if (inv.clientCity) page.drawText(ansi(inv.clientCity), { x: M, y: y - 27, size: 10, font });
  y -= 60; const cols = [M, 200, 360, 410, 480, W - M];
  page.drawText('Worker', { x: cols[0], y, size: 10, font: bold }); page.drawText('Position', { x: cols[1], y, size: 10, font: bold });
  right('Reg hrs', cols[2], y, bold); right('OT hrs', cols[3], y, bold); right('Rate', cols[4], y, bold); right('Amount', cols[5], y, bold);
  y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6 }); y -= 16;
  let total = 0;
  for (const l of inv.lines) {
    if (y < 90) { page = pdf.addPage([W, H]); y = H - 64; }
    total += l.amount;
    page.drawText(ansi(l.worker).slice(0, 26), { x: cols[0], y, size: 10, font }); page.drawText(ansi(l.position).slice(0, 26), { x: cols[1], y, size: 10, font });
    right(l.reg.toFixed(2), cols[2], y); right(l.ot.toFixed(2), cols[3], y); right(`$${l.rate.toFixed(2)}`, cols[4], y); right(`$${l.amount.toFixed(2)}`, cols[5], y); y -= 18;
  }
  page.drawLine({ start: { x: 330, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.6 });
  right('Total due', cols[4], y - 8, bold, 11); right(`$${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, cols[5], y - 8, bold, 11);
  page.drawText('Overtime billed at 1.5x the regular bill rate. Thank you for your business.', { x: M, y: 50, size: 9, font });
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
