import type { Analysis } from './analyze';
import { splitSentences } from './tokenize';

export const OUTPUT_KINDS = ['title', 'description', 'caption', 'script', 'article', 'newsletter', 'post'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export const PLACEHOLDERS = ['titulo', 'trecho', 'keywords', 'cta', 'resumo'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateContext = Record<Placeholder, string>;

type Catalog = Record<OutputKind, string>;

// Todas as saídas abaixo são TEMPLATES determinísticos (source_kind = 'template'). Não são IA.
const CATALOG: Record<'en' | 'pt', Catalog> = {
  en: {
    title: '{{titulo}}',
    description: '{{trecho}}\n\nTopics: {{keywords}}.',
    caption: '{{titulo}}: {{trecho}}\n{{cta}}',
    script:
      'SCRIPT: {{titulo}}\n\n1. Opening: {{titulo}}\n2. Development: {{trecho}}\n3. Key points: {{keywords}}\n4. Closing: {{cta}}',
    article: '# {{titulo}}\n\n{{resumo}}\n\n## Key topics\n\n{{keywords}}\n\n{{cta}}',
    newsletter: 'Subject: {{titulo}}\n\nHello,\n\n{{resumo}}\n\nTopics: {{keywords}}.\n\n{{cta}}',
    post: '{{trecho}}\n\n{{cta}}',
  },
  pt: {
    title: '{{titulo}}',
    description: '{{trecho}}\n\nTemas: {{keywords}}.',
    caption: '{{titulo}}: {{trecho}}\n{{cta}}',
    script:
      'ROTEIRO: {{titulo}}\n\n1. Abertura: {{titulo}}\n2. Desenvolvimento: {{trecho}}\n3. Pontos-chave: {{keywords}}\n4. Fechamento: {{cta}}',
    article: '# {{titulo}}\n\n{{resumo}}\n\n## Temas principais\n\n{{keywords}}\n\n{{cta}}',
    newsletter: 'Assunto: {{titulo}}\n\nOlá,\n\n{{resumo}}\n\nTemas: {{keywords}}.\n\n{{cta}}',
    post: '{{trecho}}\n\n{{cta}}',
  },
};

const DEFAULT_CTA = { en: 'Learn more.', pt: 'Saiba mais.' } as const;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export const templateLocale = (lang: string): 'en' | 'pt' => (lang === 'pt' ? 'pt' : 'en');

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => (key in ctx ? ctx[key as Placeholder] : ''));
}

export function buildContext(
  analysis: Pick<Analysis, 'keywords' | 'summary' | 'language'>,
  text: string,
  opts: { title?: string; cta?: string } = {},
): TemplateContext {
  const loc = templateLocale(analysis.language);
  const first = analysis.summary[0] ?? splitSentences(text)[0] ?? '';
  return {
    titulo: clip((opts.title?.trim() || splitSentences(text)[0] || first).replace(/[.!?…]+$/u, ''), 80),
    trecho: clip(first, 280),
    keywords: analysis.keywords.slice(0, 5).join(', '),
    cta: opts.cta?.trim() || DEFAULT_CTA[loc],
    resumo: analysis.summary.join(' '),
  };
}

export type GeneratedOutput = { channel: 'generic'; kind: OutputKind; title: string; body: string };

export function generateOutputs(
  analysis: Pick<Analysis, 'keywords' | 'summary' | 'language'>,
  text: string,
  opts: { title?: string; cta?: string; kinds?: readonly OutputKind[] } = {},
): GeneratedOutput[] {
  const ctx = buildContext(analysis, text, opts);
  const catalog = CATALOG[templateLocale(analysis.language)];
  return (opts.kinds ?? OUTPUT_KINDS).map((kind) => ({
    channel: 'generic' as const,
    kind,
    title: ctx.titulo,
    body: renderTemplate(catalog[kind], ctx),
  }));
}

export const templatesForTest = CATALOG;
