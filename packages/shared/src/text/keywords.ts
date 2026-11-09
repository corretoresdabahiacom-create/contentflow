import { isStopword } from './stopwords';
import { splitSentences, tokenize } from './tokenize';

export type Keyword = { keyword: string; score: number };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * Palavras-chave no estilo YAKE (não supervisionado, por documento): combina capitalização, posição,
 * frequência, relação com vizinhos e dispersão entre sentenças. Menor score = mais relevante.
 * É uma implementação própria simplificada, não a biblioteca YAKE original.
 */
export function yakeKeywords(text: string, lang: string, max = 10, maxNgram = 3): Keyword[] {
  const sentences = splitSentences(text).map((s) => tokenize(s));
  const nSent = sentences.length;
  if (nSent === 0) return [];

  type Stat = { tf: number; upper: number; cap: number; sents: Set<number>; left: Set<string>; right: Set<string>; l: number; r: number };
  const stats = new Map<string, Stat>();
  const stat = (w: string): Stat => {
    let s = stats.get(w);
    if (!s) stats.set(w, (s = { tf: 0, upper: 0, cap: 0, sents: new Set(), left: new Set(), right: new Set(), l: 0, r: 0 }));
    return s;
  };

  sentences.forEach((words, si) => {
    words.forEach((raw, wi) => {
      const w = raw.toLowerCase();
      if (isStopword(w, lang) || w.length < 3 || /^\d+$/.test(w)) return;
      const s = stat(w);
      s.tf++;
      s.sents.add(si);
      if (raw.length > 1 && raw === raw.toUpperCase() && raw !== raw.toLowerCase()) s.upper++;
      else if (wi > 0 && raw[0] === (raw[0] as string).toUpperCase() && raw[0] !== (raw[0] as string).toLowerCase()) s.cap++;
      const prev = words[wi - 1]?.toLowerCase();
      const next = words[wi + 1]?.toLowerCase();
      if (prev) {
        s.left.add(prev);
        s.l++;
      }
      if (next) {
        s.right.add(next);
        s.r++;
      }
    });
  });

  const tfs = [...stats.values()].map((s) => s.tf);
  const meanTf = mean(tfs);
  const sigma = Math.sqrt(mean(tfs.map((x) => (x - meanTf) ** 2)));
  const maxTf = Math.max(1, ...tfs);

  const S = new Map<string, number>();
  for (const [w, s] of stats) {
    const caseS = Math.max(s.upper, s.cap) / (1 + Math.log(s.tf));
    const pos = Math.log(Math.log(3 + median([...s.sents])));
    const freq = s.tf / (meanTf + sigma || 1);
    const wl = s.l ? s.left.size / s.l : 0;
    const wr = s.r ? s.right.size / s.r : 0;
    const rel = 1 + (wl + wr) * (s.tf / maxTf);
    const diff = s.sents.size / nSent;
    S.set(w, (rel * pos) / (caseS + freq / rel + diff / rel));
  }

  const cands = new Map<string, { surface: string; tf: number; words: string[] }>();
  for (const words of sentences) {
    for (let i = 0; i < words.length; i++) {
      for (let n = 1; n <= maxNgram && i + n <= words.length; n++) {
        const gram = words.slice(i, i + n);
        const low = gram.map((g) => g.toLowerCase());
        const first = low[0] as string;
        const last = low[n - 1] as string;
        if (!S.has(first) || !S.has(last)) continue; // começa e termina em termo de conteúdo
        const key = low.join(' ');
        const c = cands.get(key);
        if (c) c.tf++;
        else cands.set(key, { surface: gram.join(' '), tf: 1, words: low });
      }
    }
  }

  const scored: Keyword[] = [];
  for (const [key, c] of cands) {
    const content = c.words.filter((w) => S.has(w));
    const prod = content.reduce((a, w) => a * (S.get(w) as number), 1);
    const sum = content.reduce((a, w) => a + (S.get(w) as number), 0);
    scored.push({ keyword: c.surface === c.surface.toUpperCase() ? c.surface : key, score: prod / (c.tf * (1 + sum)) });
  }
  scored.sort((a, b) => a.score - b.score || a.keyword.localeCompare(b.keyword));

  const picked: Keyword[] = [];
  for (const k of scored) {
    const kw = new Set(k.keyword.toLowerCase().split(' '));
    const redundant = picked.some((p) => {
      const pw = new Set(p.keyword.toLowerCase().split(' '));
      return [...kw].every((w) => pw.has(w)) || [...pw].every((w) => kw.has(w));
    });
    if (!redundant) picked.push(k);
    if (picked.length >= max) break;
  }
  return picked;
}
