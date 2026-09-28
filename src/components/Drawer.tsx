'use client';
import { useEffect, useRef } from 'react';

/** Right-hand modal drawer. Esc, the close button and a backdrop click all call onClose. */
export default function Drawer({ title, kicker, onClose, children, footer }: { title: string; kicker?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} className="drawer" aria-labelledby="dTitle" onCancel={(e) => { if (e.target !== ref.current) return; /* a nested drawer's Esc */ e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dh"><div style={{ flex: 1 }}>{kicker && <div className="muted">{kicker}</div>}<h2 id="dTitle">{title}</h2></div><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="db">{children}</div>
      {footer && <div className="df">{footer}</div>}
    </dialog>
  );
}
