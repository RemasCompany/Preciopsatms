'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type SignaturePadHandle = { isEmpty: () => boolean; toDataURL: () => string; clear: () => void };

/** Draw-to-sign canvas (mouse, pen or touch). */
const SignaturePad = forwardRef<SignaturePadHandle, { label?: string }>(function SignaturePad({ label = 'Signature pad' }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  useImperativeHandle(ref, () => ({
    isEmpty: () => !drawn.current,
    toDataURL: () => canvas.current!.toDataURL('image/png'),
    clear: () => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); drawn.current = false; },
  }));
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const x = c.getContext('2d')!; x.lineWidth = 2.4; x.lineCap = 'round'; x.strokeStyle = '#10203a';
    let down = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)] as const; };
    c.onpointerdown = (e) => { down = true; c.setPointerCapture(e.pointerId); x.beginPath(); x.moveTo(...pos(e)); };
    c.onpointermove = (e) => { if (!down) return; x.lineTo(...pos(e)); x.stroke(); drawn.current = true; };
    c.onpointerup = () => { down = false; };
  }, []);
  return <canvas ref={canvas} width={600} height={180} className="sigpad" aria-label={label} />;
});
export default SignaturePad;
