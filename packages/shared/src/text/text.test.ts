import { describe, expect, it } from 'vitest';
import {
  OUTPUT_KINDS,
  PLACEHOLDERS,
  analyzeText,
  csvCell,
  detectLanguage,
  exportFilename,
  generateOutputs,
  renderTemplate,
  serialize,
  templatesForTest,
  textRankSummary,
  yakeKeywords,
  type ExportDoc,
} from '../index';

const PT = `O mercado de energia solar cresceu rapidamente no Brasil. A energia solar reduz a conta de luz das famílias e das empresas. Muitas cidades do Nordeste têm alta radiação solar durante todo o ano. Os painéis solares exigem pouca manutenção e duram mais de vinte anos. O governo criou linhas de crédito para facilitar a instalação de painéis solares. Por isso, a geração distribuída de energia solar deve continuar crescendo nos próximos anos.`;
const EN = `Remote work changed how companies hire engineers. Many teams now hire engineers from different countries without moving them. Remote work requires clear writing and good documentation. Companies that document decisions onboard engineers faster. Managers must measure results instead of hours worked. Remote work will remain common for engineering teams.`;
const ES = `La energía solar está creciendo en muchos países de América Latina. Las familias instalan paneles solares para reducir el costo de la electricidad. Los gobiernos ofrecen créditos para facilitar la instalación de paneles solares en las casas.`;

describe('detecção de idioma do conteúdo', () => {
  it('pt, en, es', () => {
    expect(detectLanguage(PT).code).toBe('pt');
    expect(detectLanguage(EN).code).toBe('en');
    expect(detectLanguage(ES).code).toBe('es');
  });
  it('texto curto => und (não chuta)', () => {
    expect(detectLanguage('oi').code).toBe('und');
  });
});

describe('palavras-chave (YAKE-inspired)', () => {
  it('encontra o tema central e é determinístico', () => {
    const a = yakeKeywords(PT, 'pt', 8).map((k) => k.keyword.toLowerCase());
    const b = yakeKeywords(PT, 'pt', 8).map((k) => k.keyword.toLowerCase());
    expect(a).toEqual(b);
    expect(a.some((k) => k.includes('solar'))).toBe(true);
    expect(a.some((k) => k.includes('energia') || k.includes('painéis'))).toBe(true);
  });
  it('não devolve stopwords isoladas nem redundâncias', () => {
    const ks = yakeKeywords(EN, 'en', 10).map((k) => k.keyword.toLowerCase());
    expect(ks).not.toContain('the');
    expect(ks.some((k) => k.includes('remote'))).toBe(true);
    expect(new Set(ks).size).toBe(ks.length);
  });
  it('texto vazio => []', () => expect(yakeKeywords('', 'en')).toEqual([]));
});

describe('resumo extrativo (TextRank)', () => {
  it('devolve no máximo N sentenças reais do texto, na ordem original', () => {
    const s = textRankSummary(PT, 'pt', 2);
    expect(s).toHaveLength(2);
    for (const x of s) expect(PT).toContain(x);
    expect(PT.indexOf(s[0] as string)).toBeLessThan(PT.indexOf(s[1] as string));
  });
  it('texto curto devolve tudo', () => {
    expect(textRankSummary('Uma frase curta mas válida aqui.', 'pt', 3)).toHaveLength(1);
  });
});

describe('analyzeText', () => {
  it('produz análise completa e rotulada', () => {
    const a = analyzeText(PT);
    expect(a.language).toBe('pt');
    expect(a.keywords.length).toBeGreaterThan(3);
    expect(a.summary.length).toBeGreaterThan(0);
    expect(a.stats.sentences).toBe(6);
    expect(a.algorithms.keywords).toContain('yake-inspired');
  });
});

describe('templates', () => {
  it('só usam placeholders conhecidos', () => {
    for (const cat of Object.values(templatesForTest))
      for (const t of Object.values(cat))
        for (const m of t.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) expect(PLACEHOLDERS).toContain(m[1]);
  });
  it('renderTemplate substitui e ignora desconhecidos', () => {
    const ctx = { titulo: 'T', trecho: 'X', keywords: 'k', cta: 'c', resumo: 'r', hashtags: '#h' };
    expect(renderTemplate('{{titulo}}-{{ cta }}-{{nada}}', ctx)).toBe('T-c-');
  });
  it('gera os 7 tipos, no idioma do conteúdo, sem placeholders restantes', () => {
    const a = analyzeText(PT);
    const outs = generateOutputs(a, PT, { title: 'Energia solar' });
    expect(outs.map((o) => o.kind)).toEqual([...OUTPUT_KINDS]);
    for (const o of outs) {
      expect(o.body).not.toMatch(/\{\{/);
      expect(o.body.length).toBeGreaterThan(0);
    }
    expect(outs.find((o) => o.kind === 'script')?.body).toContain('ROTEIRO');
    expect(generateOutputs(analyzeText(EN), EN).find((o) => o.kind === 'script')?.body).toContain('SCRIPT');
  });
  it('é determinístico', () => {
    const a = analyzeText(PT);
    expect(generateOutputs(a, PT)).toEqual(generateOutputs(a, PT));
  });
});

describe('exportação', () => {
  const doc: ExportDoc = {
    schema: 'contentflow.export',
    schemaVersion: 1,
    exportedAt: '2026-11-09T00:00:00.000Z',
    project: { id: 'p1', name: 'Meu projeto' },
    client: { id: 'c1', name: 'Eu' },
    source: { kind: 'pasted', filename: null, chars: 10 },
    analysis: null,
    outputs: [
      { id: 'o1', channel: 'generic', kind: 'post', title: 'Olá, "mundo"', body: 'linha 1\nlinha 2', version: 2, sourceKind: 'template', updatedAt: 1 },
      { id: 'o2', channel: 'generic', kind: 'post', title: null, body: '=HYPERLINK("http://x")', version: 1, sourceKind: 'template', updatedAt: 1 },
    ],
  };
  it('CSV escapa aspas/quebras e neutraliza fórmulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=1+1')).toBe("'=1+1");
    const csv = serialize(doc, 'csv');
    expect(csv).toContain('"Olá, ""mundo"""');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv.split('\r\n')[0]).toBe('id,channel,kind,title,body,version,source_kind');
  });
  it('JSON carrega schema versionado e sourceKind', () => {
    const j = JSON.parse(serialize(doc, 'json'));
    expect(j.schema).toBe('contentflow.export');
    expect(j.schemaVersion).toBe(1);
    expect(j.outputs[0].sourceKind).toBe('template');
  });
  it('TXT e MD incluem o rótulo de origem', () => {
    expect(serialize(doc, 'txt')).toContain('[template]');
    expect(serialize(doc, 'md')).toContain('source: template');
  });
  it('nome de arquivo seguro', () => {
    expect(exportFilename('Meu Projeto/../x?', 'md')).toBe('Meu-Projeto-..-x.md');
    expect(exportFilename('???', 'csv')).toBe('project.csv');
  });
});
