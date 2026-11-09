import { yakeKeywords } from './keywords';
import { detectLanguage, type DetectedLanguage } from './language';
import { textRankSummary } from './summary';
import { splitSentences, tokenize } from './tokenize';

export const TEXT_MAX_CHARS = 200_000;
export const ANALYSIS_VERSION = 1;

export type Analysis = {
  version: number;
  language: DetectedLanguage['code'];
  keywords: string[];
  summary: string[];
  stats: { chars: number; words: number; sentences: number };
  algorithms: { language: string; keywords: string; summary: string };
};

/** Análise 100% determinística e local (roda no navegador; o Worker Free tem 10 ms de CPU). */
export function analyzeText(text: string): Analysis {
  const clipped = text.slice(0, TEXT_MAX_CHARS);
  const lang = detectLanguage(clipped);
  return {
    version: ANALYSIS_VERSION,
    language: lang.code,
    keywords: yakeKeywords(clipped, lang.code, 10).map((k) => k.keyword),
    summary: textRankSummary(clipped, lang.code, 3),
    stats: { chars: clipped.length, words: tokenize(clipped).length, sentences: splitSentences(clipped).length },
    algorithms: { language: 'franc-min', keywords: 'yake-inspired@1', summary: 'textrank-tfidf@1' },
  };
}
