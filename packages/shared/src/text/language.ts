import { franc } from 'franc-min';

export type DetectedLanguage = { code: 'pt' | 'en' | 'es' | 'other' | 'und'; iso3: string };
const MAP: Record<string, 'pt' | 'en' | 'es'> = { por: 'pt', eng: 'en', spa: 'es' };

/** Detecta o idioma do CONTEÚDO (não da interface). Textos curtos (< 20 caracteres) retornam 'und'. */
export function detectLanguage(text: string): DetectedLanguage {
  const sample = text.slice(0, 20_000);
  const iso3 = franc(sample, { minLength: 20 });
  if (iso3 === 'und') return { code: 'und', iso3 };
  return { code: MAP[iso3] ?? 'other', iso3 };
}
