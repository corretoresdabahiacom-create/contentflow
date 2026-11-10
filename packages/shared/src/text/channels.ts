import type { Analysis } from './analyze';
import { buildContext, renderTemplate, templateLocale, type GeneratedOutput, type OutputKind } from './templates';

export const CHANNELS = ['youtube', 'instagram', 'tiktok', 'linkedin', 'facebook', 'blog', 'email'] as const;
export type Channel = (typeof CHANNELS)[number];
/** Canais aceitos pela API (generic = saídas da Fase 2). */
export const ALL_CHANNELS = ['generic', ...CHANNELS] as const;

type Spec = { kind: OutputKind; pt: string; en: string; maxChars?: number };

// Tudo aqui é TEMPLATE determinístico (source_kind = 'template'), não IA.
// maxChars são tamanhos aproximados/recomendados e podem mudar nas plataformas: confira antes de publicar.
export const CHANNEL_SPECS: Record<Channel, Spec[]> = {
  youtube: [
    { kind: 'title', pt: '{{titulo}}', en: '{{titulo}}', maxChars: 100 },
    { kind: 'description', pt: '{{resumo}}\n\nNeste vídeo: {{keywords}}.\n\n{{cta}}\n\n{{hashtags}}', en: '{{resumo}}\n\nIn this video: {{keywords}}.\n\n{{cta}}\n\n{{hashtags}}', maxChars: 5000 },
    { kind: 'script', pt: 'ROTEIRO: {{titulo}}\n\n1. Gancho: {{trecho}}\n2. Desenvolvimento: {{resumo}}\n3. Pontos-chave: {{keywords}}\n4. Fechamento: {{cta}}', en: 'SCRIPT: {{titulo}}\n\n1. Hook: {{trecho}}\n2. Body: {{resumo}}\n3. Key points: {{keywords}}\n4. Closing: {{cta}}' },
  ],
  instagram: [
    { kind: 'caption', pt: '{{trecho}}\n\n{{cta}}\n\n{{hashtags}}', en: '{{trecho}}\n\n{{cta}}\n\n{{hashtags}}', maxChars: 2200 },
  ],
  tiktok: [
    { kind: 'caption', pt: '{{titulo}} {{hashtags}}', en: '{{titulo}} {{hashtags}}', maxChars: 2200 },
    { kind: 'script', pt: 'ROTEIRO CURTO\n\nGancho (3 s): {{titulo}}\nMeio: {{trecho}}\nFinal: {{cta}}', en: 'SHORT SCRIPT\n\nHook (3 s): {{titulo}}\nMiddle: {{trecho}}\nEnd: {{cta}}' },
  ],
  linkedin: [
    { kind: 'post', pt: '{{titulo}}\n\n{{resumo}}\n\nTemas: {{keywords}}.\n\n{{cta}}\n\n{{hashtags}}', en: '{{titulo}}\n\n{{resumo}}\n\nTopics: {{keywords}}.\n\n{{cta}}\n\n{{hashtags}}', maxChars: 3000 },
  ],
  facebook: [
    { kind: 'post', pt: '{{trecho}}\n\n{{cta}}', en: '{{trecho}}\n\n{{cta}}', maxChars: 63000 },
  ],
  blog: [
    { kind: 'article', pt: '# {{titulo}}\n\n{{resumo}}\n\n## Temas principais\n\n{{keywords}}\n\n{{cta}}', en: '# {{titulo}}\n\n{{resumo}}\n\n## Key topics\n\n{{keywords}}\n\n{{cta}}' },
  ],
  email: [
    { kind: 'newsletter', pt: 'Assunto: {{titulo}}\n\nOlá,\n\n{{resumo}}\n\nTemas: {{keywords}}.\n\n{{cta}}', en: 'Subject: {{titulo}}\n\nHello,\n\n{{resumo}}\n\nTopics: {{keywords}}.\n\n{{cta}}' },
  ],
};

/** Corta no limite aproximado do canal, sinalizando (nunca em silêncio). */
export function fitToLimit(body: string, max?: number): { body: string; truncated: boolean } {
  if (!max || body.length <= max) return { body, truncated: false };
  return { body: `${body.slice(0, max - 1).trimEnd()}…`, truncated: true };
}

export function generateChannelOutputs(
  analysis: Pick<Analysis, 'keywords' | 'summary' | 'language'>,
  text: string,
  opts: { channels?: readonly Channel[]; title?: string; cta?: string } = {},
): GeneratedOutput[] {
  const ctx = buildContext(analysis, text, opts);
  const loc = templateLocale(analysis.language);
  const out: GeneratedOutput[] = [];
  for (const ch of opts.channels ?? CHANNELS) {
    for (const spec of CHANNEL_SPECS[ch]) {
      const rendered = renderTemplate(spec[loc], ctx).replace(/\n{3,}/g, '\n\n').trim();
      const fit = fitToLimit(rendered, spec.maxChars);
      out.push({ channel: ch, kind: spec.kind, title: ctx.titulo, body: fit.body, truncated: fit.truncated || undefined });
    }
  }
  return out;
}
