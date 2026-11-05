'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { ComposeDrawer, type Recipient } from './Compose';

type Person = Recipient & { sub: string | null };
const KIND: Record<Recipient['type'], string> = { candidate: 'Candidate', contact: 'Client contact', lead: 'Lead', vendor: 'Vendor' };

/** "New message": find anyone by name, email, phone or company, then write them an email or a text. */
export default function NewMessage() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [to, setTo] = useState<Recipient | null>(null);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setPeople(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/messages/recipients?q=${encodeURIComponent(q.trim())}`);
      if (live && r.ok) setPeople((await r.json()).people);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  const close = () => { setOpen(false); setQ(''); setPeople(null); };
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>+ New message</button>
      {open && (
        <Drawer title="New message" kicker="Email or text" onClose={close}>
          <label><span>To</span><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, email, phone or company…" aria-label="Search people to message" /></label>
          {people === null ? <p className="muted">Type at least two letters to find a candidate, worker, client contact, lead or vendor.</p>
            : people.length ? <div className="list">{people.map((p) => (
              <button key={`${p.type}:${p.id}`} className="link li" onClick={() => { setTo(p); close(); }}>
                <span className="x"><b>{p.name}</b><span className="muted">{[KIND[p.type], p.sub].filter(Boolean).join(' · ')}</span></span>
                <span className="muted" style={{ fontSize: 13 }}>{[p.email && !p.emailOptOut ? 'Email' : null, p.phone && !p.smsOptOut ? 'Text' : null].filter(Boolean).join(' · ') || 'Opted out'}</span>
              </button>
            ))}</div>
            : <p className="muted">No one with an email or phone matches “{q.trim()}”.</p>}
        </Drawer>
      )}
      {to && <ComposeDrawer to={to} onClose={() => setTo(null)} onSent={() => router.refresh()} />}
    </>
  );
}
