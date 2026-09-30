'use client';
import { useEffect, useRef, useState } from 'react';
import SignaturePad, { type SignaturePadHandle } from '@/components/SignaturePad';

type Doc = { title: string; body: string; signerName: string; company: string; brandColor: string };

export default function SignPage({ params, searchParams }: { params: { token: string }; searchParams: { back?: string } }) {
  // Only ever link back to a worker's own page on this site.
  const back = searchParams.back && /^\/shifts\/[\w-]{20,100}$/.test(searchParams.back) ? searchParams.back : null;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);

  useEffect(() => { fetch(`/api/sign/${params.token}`).then(async (r) => { const j = await r.json(); if (r.ok) { setDoc(j); setName(j.signerName); } else setMsg(j.error); }); }, [params.token]);
  async function sign() {
    if (!pad.current || pad.current.isEmpty()) return setMsg('Draw your signature in the box.');
    if (!consent) return setMsg('Check the box to agree to sign electronically.');
    const r = await fetch(`/api/sign/${params.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, signature: pad.current.toDataURL(), consent: true }) });
    const j = await r.json(); if (r.ok) setDone(true); else setMsg(j.error);
  }

  if (done) return <main className="public"><h1>Signed</h1><p>Thank you. A signed copy has been emailed to you.</p>{back && <a className="btn" href={back}>Back to your new-hire steps</a>}</main>;
  if (!doc) return <main className="public"><p>{msg || 'Loading…'}</p></main>;
  return (
    <main className="public" style={{ ['--accent' as string]: doc.brandColor }}>
      <p className="muted">{doc.company} requests your signature</p>
      <h1>{doc.title}</h1>
      <article className="card doc">{doc.body}</article>
      <div className="card">
        <label>Full legal name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <p className="muted">Draw your signature</p>
        <SignaturePad ref={pad} />
        <button type="button" className="btn ghost" onClick={() => pad.current?.clear()}>Clear</button>
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree to use electronic records and signatures, I have reviewed this document, and I intend to sign it.</label>
        {msg && <p className="error" role="alert">{msg}</p>}
        <button className="btn" onClick={sign}>Adopt and sign</button>
      </div>
    </main>
  );
}
