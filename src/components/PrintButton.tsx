'use client';

/** Opens the browser's print dialog (where "Save as PDF" lives). */
export default function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return <button className="btn sm" onClick={() => window.print()}>{label}</button>;
}
