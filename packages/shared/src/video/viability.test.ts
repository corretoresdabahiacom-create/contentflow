import { describe, expect, it } from 'vitest';
import { VIABILITY_CSV_HEADER, evaluateViability, parseViabilityCsv, percentile, type ViabilityRow } from './viability';

const row = (o: Partial<ViabilityRow> = {}): ViabilityRow => ({
  browserId: 'B1', machineId: 'M1', fileId: 'F3', durationS: 180, status: 'success', wallS: 200, cpuS: 190, peakRamMb: 900, outputMb: 40,
  outputPlays: 'yes', audioSync: 'ok', cancelled: false, ...o,
});
const passing = (): ViabilityRow[] => [
  ...['F1', 'F2', 'F3'].flatMap((f) => Array.from({ length: 7 }, () => row({ fileId: f }))),
  ...Array.from({ length: 10 }, () => row({ status: 'cancelled', cancelled: true })),
];

describe('parseViabilityCsv', () => {
  it('aceita apenas o cabeçalho e valida linhas', () => {
    expect(parseViabilityCsv(`${VIABILITY_CSV_HEADER}\n`)).toEqual([]);
    expect(parseViabilityCsv('')).toEqual([]);
    expect(parseViabilityCsv(`${VIABILITY_CSV_HEADER}\nB1,M1,F1,30,success,40,38,800,10,yes,ok,no\n`)[0]).toMatchObject({ fileId: 'F1', wallS: 40, outputPlays: 'yes' });
    expect(() => parseViabilityCsv('x,y\n1,2')).toThrow(/Cabeçalho/);
    expect(() => parseViabilityCsv(`${VIABILITY_CSV_HEADER}\nB1,M1,F1,30,boom,40,38,800,10,yes,ok,no`)).toThrow(/status/);
    expect(() => parseViabilityCsv(`${VIABILITY_CSV_HEADER}\nB1,M1,F1`)).toThrow(/12 colunas/);
  });
});

describe('evaluateViability', () => {
  it('sem dados: blocked e not_enabled', () => {
    const r = evaluateViability([]);
    expect(r).toMatchObject({ status: 'blocked', decision: 'not_enabled' });
    expect(r.hypotheses.filter((h) => h.blocking).every((h) => h.verdict === 'insufficient')).toBe(true);
  });
  it('todas as hipóteses bloqueantes ok e matriz mínima: passed/enabled', () => {
    const r = evaluateViability(passing());
    expect(r.hypotheses.filter((h) => h.blocking).map((h) => h.verdict)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(r).toMatchObject({ status: 'passed', decision: 'enabled' });
  });
  it('H2 falha quando p90 passa de 3×', () => {
    const rows = passing().map((r, i) => (i < 3 ? { ...r, wallS: 700 } : r));
    expect(evaluateViability(rows).hypotheses.find((h) => h.id === 'H2')?.verdict).toBe('fail');
    expect(evaluateViability(rows).decision).toBe('not_enabled');
  });
  it('H3 falha com pico ≥ 2 GB e H1 falha com menos de 95%', () => {
    const r = evaluateViability(passing().map((x, i) => (i === 0 ? { ...x, peakRamMb: 2100 } : x)));
    expect(r.hypotheses.find((h) => h.id === 'H3')?.verdict).toBe('fail');
    const r2 = evaluateViability(passing().map((x, i) => (i < 2 ? { ...x, status: 'failed' as const } : x)));
    expect(r2.hypotheses.find((h) => h.id === 'H1')?.verdict).toBe('fail');
    expect(r2.status).toBe('failed');
  });
  it('sem a matriz mínima não habilita mesmo com tudo ok', () => {
    const rows = passing().filter((r) => r.fileId !== 'F2');
    expect(evaluateViability(rows).minimumMatrix.missing).toEqual(['F2']);
    expect(evaluateViability(rows).decision).toBe('not_enabled');
  });
  it('H6/H7 são informativas e não bloqueiam', () => {
    const r = evaluateViability(passing());
    expect(r.hypotheses.filter((h) => !h.blocking).map((h) => h.id)).toEqual(['H6', 'H7']);
    expect(r.decision).toBe('enabled');
  });
});

describe('percentile', () => {
  it('p50 e p90 por posto', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([], 0.5)).toBeNaN();
  });
});
