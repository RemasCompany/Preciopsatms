// Replaces the names of known people (workers, employees, teammates) in free text with "Person A", "Person B"…
// before it goes to the AI, and puts them back in the answer. Full names are matched first; a first name on its own
// is only matched when it's capitalized and belongs to just one known person. Pure (tested).

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alias = (i: number) => `Person ${i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26))}`;

export function pseudonymize(texts: string[], names: string[]) {
  const people = [...new Set(names.map((n) => n.trim().replace(/\s+/g, ' ')).filter((n) => n.length >= 3))];
  const firsts = new Map<string, string[]>();
  for (const n of people) { const f = n.split(' ')[0]; if (f.length >= 3 && n.includes(' ')) firsts.set(f.toLowerCase(), [...(firsts.get(f.toLowerCase()) ?? []), n]); }
  const assigned = new Map<string, string>(); // real full name → alias
  const aliasFor = (n: string) => { if (!assigned.has(n)) assigned.set(n, alias(assigned.size)); return assigned.get(n)!; };
  // One pass, left to right, so letters follow the order people are mentioned. Longest names first in the
  // alternation, so "Ana Maria Lopez" wins over "Ana Maria".
  const full = [...people].sort((a, b) => b.length - a.length);
  const byLower = new Map(full.map((n) => [n.toLowerCase(), n]));
  const re = full.length ? new RegExp(`(?<![\\p{L}])(?:${full.map(esc).join('|')})(?![\\p{L}])`, 'giu') : null;
  const out = texts.map((t) => {
    let s = re ? t.replace(re, (m) => aliasFor(byLower.get(m.toLowerCase())!)) : t;
    s = s.replace(/(?<![\p{L}])(\p{Lu}[\p{Ll}'’-]{2,})(?![\p{L}])/gu, (w) => {
      const owners = firsts.get(w.toLowerCase());
      return owners && owners.length === 1 ? aliasFor(owners[0]) : w;
    });
    return s;
  });
  const back = new Map([...assigned].map(([n, a]) => [a, n]));
  /** Puts the real names back (longest aliases first, so "Person AB" isn't read as "Person A" + "B"). */
  const restore = (s: string) => [...back.keys()].sort((a, b) => b.length - a.length).reduce((x, a) => x.replace(new RegExp(`\\b${esc(a)}\\b`, 'g'), back.get(a)!), s);
  return { texts: out, restore, count: assigned.size };
}
