/**
 * Avaliação dos dados brutos do teste de viabilidade do ffmpeg.wasm (docs/video-viability.md §2-§6).
 * Função pura: lê as linhas do CSV e devolve o veredito por hipótese. Sem dados suficientes o resultado
 * é `blocked` e a decisão é `not_enabled`: a renderização só é habilitada com evidência.
 */
export const VIABILITY_CSV_HEADER = 'browser_id,machine_id,file_id,duration_s,status,wall_time_s,cpu_time_s,peak_ram_mb,output_size_mb,output_plays,audio_sync,cancelled';

export type ViabilityRow = {
  browserId: string; machineId: string; fileId: string; durationS: number;
  status: 'success' | 'failed' | 'cancelled' | 'crashed';
  wallS: number; cpuS: number; peakRamMb: number; outputMb: number;
  outputPlays: 'yes' | 'no' | ''; audioSync: 'ok' | 'desync' | ''; cancelled: boolean;
};
export type Verdict = 'pass' | 'fail' | 'insufficient';
export type Hypothesis = { id: string; title: string; blocking: boolean; verdict: Verdict; detail: string };
export type ViabilityReport = {
  hypotheses: Hypothesis[];
  minimumMatrix: { present: string[]; missing: string[] };
  status: 'passed' | 'failed' | 'blocked';
  decision: 'enabled' | 'not_enabled';
  rows: number;
};

const STATUSES = new Set(['success', 'failed', 'cancelled', 'crashed']);

export function parseViabilityCsv(text: string): ViabilityRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (lines[0] !== VIABILITY_CSV_HEADER) throw new Error(`Cabeçalho inesperado; esperado: ${VIABILITY_CSV_HEADER}`);
  return lines.slice(1).map((line, i) => {
    const c = line.split(',').map((x) => x.trim());
    if (c.length !== 12) throw new Error(`Linha ${i + 2}: 12 colunas esperadas, ${c.length} encontradas`);
    const [browserId, machineId, fileId, dur, status, wall, cpu, ram, out, plays, sync, canc] = c as [string, string, string, string, string, string, string, string, string, string, string, string];
    if (!STATUSES.has(status)) throw new Error(`Linha ${i + 2}: status inválido "${status}"`);
    const num = (v: string, name: string) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Linha ${i + 2}: ${name} inválido "${v}"`);
      return n;
    };
    return {
      browserId, machineId, fileId, durationS: num(dur, 'duration_s'), status: status as ViabilityRow['status'],
      wallS: num(wall, 'wall_time_s'), cpuS: num(cpu, 'cpu_time_s'), peakRamMb: num(ram, 'peak_ram_mb'), outputMb: num(out, 'output_size_mb'),
      outputPlays: plays === 'yes' || plays === 'no' ? plays : '', audioSync: sync === 'ok' || sync === 'desync' ? sync : '', cancelled: canc === 'yes',
    };
  });
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx] as number;
}

export function evaluateViability(rows: ViabilityRow[]): ViabilityReport {
  const b1 = rows.filter((r) => r.browserId === 'B1' && !r.cancelled);
  const ok = b1.filter((r) => r.status === 'success');
  const hyp: Hypothesis[] = [];
  const h = (id: string, title: string, blocking: boolean, verdict: Verdict, detail: string) => hyp.push({ id, title, blocking, verdict, detail });

  // H1: ≥ 95% de sucesso em 20 execuções (B1)
  if (b1.length < 20) h('H1', 'Chrome desktop ≥ 95% de sucesso (20 execuções)', true, 'insufficient', `${b1.length}/20 execuções`);
  else h('H1', 'Chrome desktop ≥ 95% de sucesso (20 execuções)', true, ok.length / b1.length >= 0.95 ? 'pass' : 'fail', `${ok.length}/${b1.length}`);

  // H2: tempo total < 3× a duração (mediana e p90)
  const ratios = ok.filter((r) => r.durationS > 0).map((r) => r.wallS / r.durationS);
  if (!ratios.length) h('H2', 'Tempo < 3× a duração (mediana e p90)', true, 'insufficient', 'sem execuções bem-sucedidas');
  else {
    const med = percentile(ratios, 0.5);
    const p90 = percentile(ratios, 0.9);
    h('H2', 'Tempo < 3× a duração (mediana e p90)', true, med < 3 && p90 < 3 ? 'pass' : 'fail', `mediana ${med.toFixed(2)}×, p90 ${p90.toFixed(2)}×`);
  }

  // H3: pico de memória < 2 GB em vídeo de 3 min
  const long = ok.filter((r) => r.durationS >= 150);
  if (!long.length) h('H3', 'Pico de memória < 2 GB (vídeo de 3 min)', true, 'insufficient', 'sem execuções de ~3 min');
  else {
    const peak = Math.max(...long.map((r) => r.peakRamMb));
    h('H3', 'Pico de memória < 2 GB (vídeo de 3 min)', true, peak < 2048 ? 'pass' : 'fail', `pico ${peak.toFixed(0)} MB`);
  }

  // H4: reproduzível com áudio sincronizado
  const judged = ok.filter((r) => r.outputPlays !== '' && r.audioSync !== '');
  if (judged.length < 9) h('H4', 'Saída reproduzível, áudio sincronizado (3 arquivos × 3 players)', true, 'insufficient', `${judged.length}/9 avaliações`);
  else {
    const bad = judged.filter((r) => r.outputPlays !== 'yes' || r.audioSync !== 'ok').length;
    h('H4', 'Saída reproduzível, áudio sincronizado (3 arquivos × 3 players)', true, bad === 0 ? 'pass' : 'fail', `${judged.length - bad}/${judged.length} ok`);
  }

  // H5: 10 cancelamentos limpos
  const canc = rows.filter((r) => r.cancelled);
  if (canc.length < 10) h('H5', 'Cancelamento limpo (10 tentativas)', true, 'insufficient', `${canc.length}/10 tentativas`);
  else {
    const clean = canc.filter((r) => r.status === 'cancelled').length;
    h('H5', 'Cancelamento limpo (10 tentativas)', true, clean === canc.length ? 'pass' : 'fail', `${clean}/${canc.length} limpos`);
  }

  // H6 e H7 informativas
  const ff = rows.filter((r) => r.browserId === 'B3' && !r.cancelled);
  if (ff.length < 20) h('H6', 'Firefox desktop ≥ 80% de sucesso', false, 'insufficient', `${ff.length}/20 execuções`);
  else {
    const n = ff.filter((r) => r.status === 'success').length;
    h('H6', 'Firefox desktop ≥ 80% de sucesso', false, n / ff.length >= 0.8 ? 'pass' : 'fail', `${n}/${ff.length}`);
  }
  const an = rows.filter((r) => r.browserId === 'B5');
  if (an.length < 10) h('H7', 'Chrome Android falha de forma segura', false, 'insufficient', `${an.length}/10 tentativas`);
  else {
    const crashes = an.filter((r) => r.status === 'crashed').length;
    h('H7', 'Chrome Android falha de forma segura', false, crashes === 0 ? 'pass' : 'fail', `${crashes} crashes em ${an.length}`);
  }

  // matriz mínima obrigatória: B1 × M1 × {F1,F2,F3}
  const need = ['F1', 'F2', 'F3'];
  const present = need.filter((f) => rows.some((r) => r.browserId === 'B1' && r.machineId === 'M1' && r.fileId === f));
  const missing = need.filter((f) => !present.includes(f));
  const m1b1 = rows.filter((r) => r.browserId === 'B1' && r.machineId === 'M1');
  const m1Failed = m1b1.length > 0 && m1b1.some((r) => r.status === 'failed' || r.status === 'crashed') && m1b1.filter((r) => r.status === 'success').length / m1b1.length < 0.95;

  const blocking = hyp.filter((x) => x.blocking);
  const anyFail = blocking.some((x) => x.verdict === 'fail') || m1Failed;
  const allPass = blocking.every((x) => x.verdict === 'pass') && missing.length === 0;
  const status = anyFail ? 'failed' : allPass ? 'passed' : 'blocked';
  return { hypotheses: hyp, minimumMatrix: { present, missing }, status, decision: status === 'passed' ? 'enabled' : 'not_enabled', rows: rows.length };
}

const ICON: Record<Verdict, string> = { pass: '✅', fail: '❌', insufficient: '⏳ sem dados' };
export function viabilityMarkdown(r: ViabilityReport, meta: { date: string; by: string }): string {
  const out = [
    '## Resultado — vídeo viabilidade', '',
    `**Data:** ${meta.date}`, `**Executado por:** ${meta.by}`, `**Status:** ${r.status}`, `**Decisão da Fase 5:** ${r.decision}`, '',
    `Linhas de dados: ${r.rows}. Matriz mínima B1 × M1: presentes ${r.minimumMatrix.present.join(', ') || '—'}; faltando ${r.minimumMatrix.missing.join(', ') || '—'}.`, '',
    '### Hipóteses', '', '| # | Hipótese | Resultado | Passou |', '|---|---|---|---|',
    ...r.hypotheses.map((x) => `| ${x.id} | ${x.title}${x.blocking ? '' : ' _(informativa)_'} | ${x.detail} | ${ICON[x.verdict]} |`), '',
  ];
  return `${out.join('\n')}\n`;
}
