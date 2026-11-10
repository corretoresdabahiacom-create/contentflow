import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  CHANNEL_SPECS,
  OUTPUT_KINDS,
  PLACEHOLDERS,
  analyzeText,
  fitToLimit,
  generateChannelOutputs,
  hasSubtitles,
  serialize,
  toHashtags,
  type ExportDoc,
} from '../index';

const PT = 'O mercado de energia solar cresceu rapidamente no Brasil. A energia solar reduz a conta de luz das famílias e das empresas. Muitas cidades do Nordeste têm alta radiação solar durante todo o ano. Os painéis solares exigem pouca manutenção e duram mais de vinte anos. O governo criou linhas de crédito para facilitar a instalação de painéis solares.';

describe('templates por canal', () => {
  it('só usam placeholders conhecidos e tipos válidos', () => {
    for (const specs of Object.values(CHANNEL_SPECS))
      for (const s of specs) {
        expect(OUTPUT_KINDS).toContain(s.kind);
        for (const t of [s.pt, s.en]) for (const m of t.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) expect(PLACEHOLDERS).toContain(m[1]);
      }
  });
  it('gera todos os canais, sem placeholders restantes, determinístico', () => {
    const a = analyzeText(PT);
    const outs = generateChannelOutputs(a, PT, { title: 'Energia solar' });
    expect(new Set(outs.map((o) => o.channel))).toEqual(new Set(CHANNELS));
    for (const o of outs) {
      expect(o.body).not.toMatch(/\{\{/);
      expect(o.body).not.toMatch(/\n{3,}/);
      expect(o.body.length).toBeGreaterThan(0);
    }
    expect(outs.find((o) => o.channel === 'instagram')?.body).toMatch(/#\w+/);
    expect(outs.find((o) => o.channel === 'linkedin')?.body).toContain('Temas:');
    expect(generateChannelOutputs(a, PT)).toEqual(generateChannelOutputs(a, PT));
  });
  it('seleciona canais e usa o idioma do conteúdo', () => {
    const en = 'Remote work changed how companies hire engineers. Many teams hire engineers from different countries. Remote work requires clear writing and documentation.';
    const outs = generateChannelOutputs(analyzeText(en), en, { channels: ['email'] });
    expect(outs).toHaveLength(1);
    expect(outs[0]?.body).toContain('Subject:');
  });
  it('limite de canal sinaliza truncamento (nunca em silêncio)', () => {
    expect(fitToLimit('abc', 10)).toEqual({ body: 'abc', truncated: false });
    const r = fitToLimit('x'.repeat(50), 10);
    expect(r.truncated).toBe(true);
    expect(r.body).toHaveLength(10);
    expect(r.body.endsWith('…')).toBe(true);
    expect(fitToLimit('x'.repeat(50)).truncated).toBe(false);
  });
  it('hashtags: sem acento, sem espaço, sem duplicata', () => {
    expect(toHashtags(['energia solar', 'Painéis', 'energia solar', 'ab'])).toBe('#energiasolar #paineis');
  });
});

describe('export SRT/VTT e clips', () => {
  const doc: ExportDoc = {
    schema: 'contentflow.export', schemaVersion: 1, exportedAt: 'x',
    project: { id: 'p', name: 'P' }, client: { id: 'c', name: 'C' }, source: null, analysis: null, outputs: [],
    transcript: { id: 't', origin: 'srt', language: 'pt', segments: [{ startMs: 0, endMs: 1500, text: 'Olá.' }] },
    clips: [{ id: 'k', startMs: 65_000, endMs: 95_000, title: 'Clip', justification: 'Contém 1 pergunta(s).', excerpt: 'trecho', notes: 'minha nota', edited: true, version: 2 }],
  };
  it('SRT/VTT vêm da transcrição com timestamps', () => {
    expect(hasSubtitles(doc)).toBe(true);
    expect(serialize(doc, 'srt')).toBe('1\n00:00:00,000 --> 00:00:01,500\nOlá.\n');
    expect(serialize(doc, 'vtt')).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nOlá.\n');
    expect(hasSubtitles({ ...doc, transcript: null })).toBe(false);
  });
  it('MD/TXT/JSON incluem os cortes com a justificativa e a ressalva de heurística', () => {
    const md = serialize(doc, 'md');
    expect(md).toContain('text heuristic, not video analysis');
    expect(md).toContain('1:05–1:35 · Clip');
    expect(md).toContain('Why: Contém 1 pergunta(s).');
    expect(md).toContain('Notes: minha nota');
    expect(serialize(doc, 'txt')).toContain('clip 1:05-1:35: Clip');
    expect(JSON.parse(serialize(doc, 'json')).clips[0].justification).toContain('pergunta');
  });
});
