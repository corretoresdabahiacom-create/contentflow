import { yakeKeywords } from '../text/keywords';
import { cosine, tfidfVectors } from '../text/summary';
import { tokenize } from '../text/tokenize';
import { templateLocale } from '../text/templates';
import type { Segment } from './subtitles';

/**
 * Sugestão de cortes por HEURÍSTICA TEXTUAL sobre segmentos com timestamps.
 * Sinais usados: mudança de assunto (cosseno TF-IDF entre janelas), pausa longa, pergunta, imperativo,
 * número, citação e palavras-chave. Não analisa áudio nem vídeo: não detecta emoção, expressão facial,
 * tom de voz nem potencial de viralização, e nunca deve ser descrito assim.
 */
export const CLIP_HEURISTIC_VERSION = 1;

export type ClipSignals = {
  topicShift: number | null; // similaridade com o trecho anterior (menor = mudança maior)
  pauseMs: number | null;
  questions: number;
  imperatives: number;
  numbers: number;
  quotes: number;
  keywords: string[];
};
export type ClipSuggestion = {
  startMs: number;
  endMs: number;
  title: string;
  justification: string;
  excerpt: string;
  score: number;
  signals: ClipSignals;
};
export type ClipOptions = { minMs?: number; maxMs?: number; window?: number; maxClips?: number; pauseMs?: number };

const IMPERATIVES: Record<'pt' | 'en' | 'es', Set<string>> = {
  pt: new Set('misture asse junte adicione faça faz veja vê use usa pense lembre comece começa aprenda descubra evite tente imagine olhe pare escolha anote compartilhe salve assista experimente pergunte conte'.split(' ')),
  en: new Set('mix bake add do see use think remember start learn discover avoid try imagine look stop choose note share save watch ask tell make get take'.split(' ')),
  es: new Set('haz mira usa piensa recuerda empieza aprende descubre evita prueba imagina observa para elige anota comparte guarda mira pregunta cuenta'.split(' ')),
};
const QUOTE = /["“”«»]/;

type Vec = Map<string, number>;
function addVec(into: Vec, v: Vec) {
  for (const [w, x] of v) into.set(w, (into.get(w) ?? 0) + x);
}

function countSignals(text: string, lang: 'pt' | 'en' | 'es', kws: string[]) {
  const sentences = text.split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
  let questions = 0;
  let imperatives = 0;
  for (const s of sentences) {
    if (/[?¿]/.test(s)) questions++;
    const first = tokenize(s)[0]?.toLowerCase();
    if (first && IMPERATIVES[lang].has(first)) imperatives++;
  }
  const lower = text.toLowerCase();
  return {
    questions,
    imperatives,
    numbers: (text.match(/\d+(?:[.,]\d+)?/g) ?? []).length,
    quotes: QUOTE.test(text) ? 1 : 0,
    keywords: kws.filter((k) => lower.includes(k.toLowerCase())).slice(0, 3),
  };
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function suggestClips(segments: readonly Segment[], langCode: string, opts: ClipOptions = {}): ClipSuggestion[] {
  const minMs = opts.minMs ?? 15_000;
  const maxMs = opts.maxMs ?? 90_000;
  const win = opts.window ?? 4;
  const maxClips = opts.maxClips ?? 8;
  const pauseThreshold = opts.pauseMs ?? 2_000;
  const n = segments.length;
  if (n < 2) return [];
  const lang: 'pt' | 'en' | 'es' = langCode === 'pt' || langCode === 'es' ? langCode : 'en';
  const loc = templateLocale(langCode);

  // 1) mudança de assunto: similaridade entre a janela anterior e a seguinte, em cada fronteira
  const vecs = tfidfVectors(segments.map((s) => s.text), lang);
  const sim: (number | null)[] = Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const L: Vec = new Map();
    const R: Vec = new Map();
    for (let k = Math.max(0, i - win); k < i; k++) addVec(L, vecs[k] as Vec);
    for (let k = i; k < Math.min(n, i + win); k++) addVec(R, vecs[k] as Vec);
    sim[i] = cosine(L, R);
  }
  const vals = sim.filter((x): x is number => x !== null);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  const isShift = (i: number) => {
    const v = sim[i];
    if (v === null || v === undefined) return false;
    const l = sim[i - 1] ?? Infinity;
    const r = sim[i + 1] ?? Infinity;
    return v < mean - 0.5 * std && v <= l && v <= r;
  };

  // 2) pontos de corte = mudança de assunto ou pausa longa; sempre em fronteira de segmento
  const cuts: number[] = [0];
  for (let i = 1; i < n; i++) {
    const gap = (segments[i] as Segment).startMs - (segments[i - 1] as Segment).endMs;
    if (isShift(i) || gap >= pauseThreshold) cuts.push(i);
  }
  cuts.push(n);

  // 3) normaliza duração: quebra spans longos e junta curtos
  const spans: [number, number][] = [];
  for (let c = 0; c < cuts.length - 1; c++) {
    let from = cuts[c] as number;
    const to = cuts[c + 1] as number;
    let k = from;
    for (; k < to; k++) {
      const dur = (segments[k] as Segment).endMs - (segments[from] as Segment).startMs;
      if (dur > maxMs && k > from) {
        spans.push([from, k]);
        from = k;
      }
    }
    spans.push([from, to]);
  }
  const dur = (s: [number, number]) => (segments[s[1] - 1] as Segment).endMs - (segments[s[0]] as Segment).startMs;
  const merged: [number, number][] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (prev && (dur(prev) < minMs || dur(s) < minMs) && dur([prev[0], s[1]]) <= maxMs) merged[merged.length - 1] = [prev[0], s[1]];
    else merged.push(s);
  }

  // 4) pontua e descreve; descarta spans fora da faixa ou sem nenhum sinal
  const allText = segments.map((s) => s.text).join(' ');
  const kws = yakeKeywords(allText, lang, 8).map((k) => k.keyword);
  const out: ClipSuggestion[] = [];
  for (const [a, b] of merged) {
    const d = dur([a, b]);
    if (d < minMs || d > maxMs) continue;
    const text = segments.slice(a, b).map((s) => s.text).join(' ');
    const sig = countSignals(text, lang, kws);
    const topicShift = a > 0 && isShift(a) ? (sim[a] as number) : null;
    const pauseMs = a > 0 ? Math.max(0, (segments[a] as Segment).startMs - (segments[a - 1] as Segment).endMs) : null;
    const pause = pauseMs !== null && pauseMs >= pauseThreshold ? pauseMs : null;
    const signals: ClipSignals = { topicShift, pauseMs: pause, ...sig };
    const score =
      (topicShift !== null ? 1 + (1 - topicShift) : 0) + (pause ? 0.5 : 0) + sig.questions * 2 + Math.min(sig.imperatives, 2) * 1.5 + Math.min(sig.numbers, 3) + sig.quotes + sig.keywords.length * 0.5;
    // palavra-chave sozinha não basta: exige ao menos um sinal estrutural
    if (topicShift === null && !pause && !sig.questions && !sig.imperatives && !sig.numbers && !sig.quotes) continue;

    const why: string[] = [];
    const L = (pt: string, en: string) => (loc === 'pt' ? pt : en);
    if (topicShift !== null) why.push(L(`Começa onde o assunto muda (similaridade de vocabulário ${topicShift.toFixed(2)} com o trecho anterior).`, `Starts where the topic shifts (vocabulary similarity ${topicShift.toFixed(2)} with the previous part).`));
    if (pause) why.push(L(`Começa após uma pausa de ${(pause / 1000).toFixed(1)} s.`, `Starts after a ${(pause / 1000).toFixed(1)} s pause.`));
    if (sig.questions) why.push(L(`Contém ${sig.questions} pergunta(s).`, `Contains ${sig.questions} question(s).`));
    if (sig.imperatives) why.push(L(`Contém ${sig.imperatives} frase(s) no imperativo.`, `Contains ${sig.imperatives} imperative sentence(s).`));
    if (sig.numbers) why.push(L(`Contém ${sig.numbers} número(s).`, `Contains ${sig.numbers} number(s).`));
    if (sig.quotes) why.push(L('Contém citação entre aspas.', 'Contains a quoted passage.'));
    if (sig.keywords.length) why.push(L(`Menciona: ${sig.keywords.join(', ')}.`, `Mentions: ${sig.keywords.join(', ')}.`));

    const first = text.split(/(?<=[.!?…])\s+/)[0] ?? text;
    out.push({
      startMs: (segments[a] as Segment).startMs,
      endMs: (segments[b - 1] as Segment).endMs,
      title: clip(first.replace(/[.!?…]+$/u, ''), 60),
      justification: why.join(' '),
      excerpt: clip(text, 400),
      score: Math.round(score * 100) / 100,
      signals,
    });
  }
  return out
    .sort((x, y) => y.score - x.score)
    .slice(0, maxClips)
    .sort((x, y) => x.startMs - y.startMs);
}
