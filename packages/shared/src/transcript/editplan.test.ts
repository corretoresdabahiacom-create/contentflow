import { describe, expect, it } from 'vitest';
import { EXPORT_SCHEMA, EXPORT_SCHEMA_VERSION, type ExportDoc } from '../text/export';
import { buildEditPlan, planFilename, planToCsv, planToJson, planToMd, planToTxt, timecode } from './editplan';

const doc = (over: Partial<ExportDoc> = {}): ExportDoc => ({
  schema: EXPORT_SCHEMA, schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: '2026-11-10T00:00:00.000Z',
  project: { id: 'p', name: 'Meu Projeto' }, client: { id: 'c', name: 'Cli' }, source: null, analysis: null, outputs: [],
  clips: [
    { id: 'k2', startMs: 65_000, endMs: 95_500, title: 'Segundo', justification: 'Contém 1 pergunta(s).', excerpt: 'trecho dois', notes: 'usar b-roll', edited: true, version: 2 },
    { id: 'k1', startMs: 0, endMs: 20_000, title: '=cmd|x', justification: 'Começa após uma pausa.', excerpt: 'trecho um', notes: null, edited: false, version: 1 },
  ],
  transcript: { id: 't', origin: 'srt', language: 'pt', segments: [
    { startMs: 0, endMs: 10_000, text: 'Primeira fala.' },
    { startMs: 10_000, endMs: 20_000, text: 'Segunda, com "aspas" e vírgula.' },
    { startMs: 60_000, endMs: 70_000, text: 'Pergunta importante?' },
  ] },
  ...over,
});

describe('timecode', () => {
  it('formata HH:MM:SS.mmm', () => {
    expect(timecode(0)).toBe('00:00:00.000');
    expect(timecode(3_723_456)).toBe('01:02:03.456');
    expect(timecode(-5)).toBe('00:00:00.000');
  });
});

describe('buildEditPlan', () => {
  it('ordena por início, numera e monta roteiro só com segmentos que tocam a janela', () => {
    const p = buildEditPlan(doc());
    expect(p.items.map((i) => [i.index, i.clipId])).toEqual([[1, 'k1'], [2, 'k2']]);
    expect(p.items[0]?.script.map((l) => l.text)).toEqual(['Primeira fala.', 'Segunda, com "aspas" e vírgula.']);
    expect(p.items[1]?.script.map((l) => l.text)).toEqual(['Pergunta importante?']);
    expect(p.items[1]).toMatchObject({ inTc: '00:01:05.000', outTc: '00:01:35.500', durationMs: 30_500, scriptSource: 'transcript', edited: true });
  });
  it('segmento que apenas encosta na borda não entra', () => {
    const p = buildEditPlan(doc({ clips: [{ id: 'k', startMs: 20_000, endMs: 40_000, title: 't', justification: '', excerpt: '', notes: null, edited: false, version: 1 }] }));
    expect(p.items[0]).toMatchObject({ scriptSource: 'none', script: [] });
  });
  it('sem transcrição usa o trecho guardado e marca a origem', () => {
    const p = buildEditPlan(doc({ transcript: null }));
    expect(p.items[0]).toMatchObject({ scriptSource: 'excerpt' });
    expect(p.items[0]?.script[0]?.text).toBe('trecho um');
  });
  it('sem cortes gera plano vazio', () => {
    expect(buildEditPlan(doc({ clips: undefined })).items).toEqual([]);
  });
});

describe('formatos', () => {
  const p = buildEditPlan(doc());
  it('txt e md trazem IN/OUT, roteiro, notas e o aviso de que não há vídeo', () => {
    for (const s of [planToTxt(p), planToMd(p)]) {
      expect(s).toContain('00:01:05.000');
      expect(s).toContain('Pergunta importante?');
      expect(s).toContain('usar b-roll');
      expect(s).toMatch(/não contém vídeo/);
    }
  });
  it('csv protege contra fórmula, escapa aspas/vírgulas e usa CRLF', () => {
    const csv = planToCsv(p);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('index,clip_id,title,in,out,duration_s,in_ms,out_ms,script,script_source,justification,notes,edited');
    expect(lines[1]).toContain("'=cmd|x");
    expect(lines[1]).toContain('"Primeira fala. Segunda, com ""aspas"" e vírgula."');
    expect(lines[2]).toContain(',30.500,65000,95500,');
  });
  it('json é válido e versionado', () => {
    const j = JSON.parse(planToJson(p));
    expect(j).toMatchObject({ schema: 'contentflow.edit-plan', schemaVersion: 1 });
    expect(j.items).toHaveLength(2);
  });
  it('nome de arquivo é seguro', () => {
    expect(planFilename('Meu Projeto/../x', 'md')).toBe('Meu-Projeto-..-x-edit-plan.md');
    expect(planFilename('///', 'csv')).toBe('project-edit-plan.csv');
  });
});
