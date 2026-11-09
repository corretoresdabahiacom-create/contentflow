import { isStopword } from './stopwords';
import { splitSentences, tokenize } from './tokenize';

/** TF-IDF por sentença (cada sentença é um "documento"). Retorna vetores esparsos. */
export function tfidfVectors(sentences: string[], lang: string): Map<string, number>[] {
  const docs = sentences.map((s) => tokenize(s).map((w) => w.toLowerCase()).filter((w) => !isStopword(w, lang) && w.length > 2));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    const v = new Map<string, number>();
    for (const [w, c] of tf) v.set(w, (c / Math.max(1, d.length)) * (Math.log(n / (df.get(w) as number)) + 1));
    return v;
  });
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [w, x] of a) {
    na += x * x;
    const y = b.get(w);
    if (y) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Resumo extrativo por TextRank (PageRank sobre similaridade de cosseno TF-IDF). Mantém a ordem original. */
export function textRankSummary(text: string, lang: string, count = 3): string[] {
  const all = splitSentences(text);
  const sentences = all.filter((s) => tokenize(s).length >= 4);
  if (sentences.length <= count) return sentences;
  const vecs = tfidfVectors(sentences, lang);
  const n = sentences.length;
  const w: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) w[i]![j] = w[j]![i] = cosine(vecs[i]!, vecs[j]!);
  const out = w.map((row) => row.reduce((a, b) => a + b, 0));
  let rank = new Array<number>(n).fill(1 / n);
  for (let it = 0; it < 40; it++) {
    const next = rank.map((_, i) => {
      let s = 0;
      for (let j = 0; j < n; j++) if (j !== i && out[j]) s += (w[j]![i]! / (out[j] as number)) * (rank[j] as number);
      return 0.15 / n + 0.85 * s;
    });
    const delta = next.reduce((a, v, i) => a + Math.abs(v - (rank[i] as number)), 0);
    rank = next;
    if (delta < 1e-6) break;
  }
  return rank
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .slice(0, count)
    .sort((a, b) => a.i - b.i)
    .map(({ i }) => sentences[i] as string);
}
