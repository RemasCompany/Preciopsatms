'use client';
import { useEffect, useRef, useState } from 'react';

type Doc = { title: string; body: string; signerName: string; company: string; brandColor: string };

export default function SignPage({ params }: { params: { token: string } }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null); const drawn = useRef(false);

  useEffect(() => { fetch(`/api/sign/${params.token}`).then(async (r) => { const j = await r.json(); if (r.ok) { setDoc(j); setName(j.signerName); } else setMsg(j.error); }); }, [params.token]);
  useEffect(() => {
    const c = canvas.current; if (!c) return; const x = c.getContext('2d')!; x.lineWidth = 2.4; x.lineCap = 'round'; x.strokeStyle = '#10203a';
    let down = false; const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)] as const; };
    c.onpointerdown = (e) => { down = true; c.setPointerCapture(e.pointerId); x.beginPath(); x.moveTo(...pos(e)); };
    c.onpointermove = (e) => { if (!down) return; x.lineTo(...pos(e)); x.stroke(); drawn.current = true; };
    c.onpointerup = () => { down = false; };
  }, [doc]);

  async function sign() {
    if (!drawn.current) return setMsg('Draw your signature in the box.');
    if (!consent) return setMsg('Check the box to agree to sign electronically.');
    const r = await fetch(`/api/sign/${params.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, signature: canvas.current!.toDataURL('image/png'), consent: true }) });
    const j = await r.json(); if (r.ok) setDone(true); else setMsg(j.error);
  }

  if (done) return <main className="public"><h1>Signed</h1><p>Thank you. A signed copy has been emailed to you.</p></main>;
  if (!doc) return <main className="public"><p>{msg || 'Loading…'}</p></main>;
  return (
    <main className="public" style={{ ['--accent' as string]: doc.brandColor }}>
      <p className="muted">{doc.company} requests your signature</p>
      <h1>{doc.title}</h1>
      <article className="card doc">{doc.body}</article>
      <div className="card">
        <label>Full legal name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <p className="muted">Draw your signature</p>
        <canvas ref={canvas} width={600} height={180} className="sigpad" aria-label="Signature pad" />
        <button type="button" className="btn ghost" onClick={() => { canvas.current!.getContext('2d')!.clearRect(0, 0, 600, 180); drawn.current = false; }}>Clear</button>
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree to use electronic records and signatures, I have reviewed this document, and I intend to sign it.</label>
        {msg && <p className="error" role="alert">{msg}</p>}
        <button className="btn" onClick={sign}>Adopt and sign</button>
      </div>
    </main>
  );
}
