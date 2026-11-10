import { csvCell, type ExportDoc } from '../text/export';
import type { Segment } from './subtitles';

/**
 * PLANO DE EDIÇÃO por corte: timestamps, roteiro e notas para o usuário editar em ferramenta externa
 * (CapCut, Premiere, DaVinci Resolve, Final Cut, Descript). Não renderiza nem corta vídeo.
 * O roteiro é a transcrição (colada, SRT/VTT ou WASM) dos segmentos que tocam a janela do corte.
 */
export const EDIT_PLAN_SCHEMA = 'contentflow.edit-plan' as const;
export const EDIT_PLAN_SCHEMA_VERSION = 1 as const;
export const EDIT_PLAN_FORMATS = ['txt', 'md', 'csv', 'json'] as const;
export type EditPlanFormat = (typeof EDIT_PLAN_FORMATS)[number];

export type EditPlanLine = { startMs: number; endMs: number; text: string };
export type EditPlanItem = {
  index: number;
  clipId: string;
  title: string;
  inMs: number;
  outMs: number;
  durationMs: number;
  /** HH:MM:SS.mmm (sem taxa de quadros: nenhum frame rate é presumido). */
  inTc: string;
  outTc: string;
  /** transcript = segmentos reais; excerpt = só o trecho guardado; none = nada disponível. */
  scriptSource: 'transcript' | 'excerpt' | 'none';
  script: EditPlanLine[];
  justification: string;
  notes: string | null;
  edited: boolean;
};
export type EditPlan = {
  schema: typeof EDIT_PLAN_SCHEMA;
  schemaVersion: typeof EDIT_PLAN_SCHEMA_VERSION;
  exportedAt: string;
  project: { id: string; name: string };
  client: { id: string; name: string };
  items: EditPlanItem[];
};

export function timecode(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(t / 3_600_000))}:${p(Math.floor(t / 60_000) % 60)}:${p(Math.floor(t / 1000) % 60)}.${p(t % 1000, 3)}`;
}

const overlaps = (s: Segment, a: number, b: number) => s.startMs < b && s.endMs > a;

/** Monta o plano a partir do documento de exportação (cortes + transcrição com segmentos). */
export function buildEditPlan(doc: ExportDoc): EditPlan {
  const segments = doc.transcript?.segments ?? [];
  const clips = [...(doc.clips ?? [])].sort((x, y) => x.startMs - y.startMs || x.endMs - y.endMs);
  const items: EditPlanItem[] = clips.map((c, i) => {
    const lines = segments.filter((s) => overlaps(s, c.startMs, c.endMs)).map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text }));
    const fallback = !lines.length && c.excerpt.trim() ? [{ startMs: c.startMs, endMs: c.endMs, text: c.excerpt.trim() }] : [];
    const script = lines.length ? lines : fallback;
    return {
      index: i + 1,
      clipId: c.id,
      title: c.title,
      inMs: c.startMs,
      outMs: c.endMs,
      durationMs: c.endMs - c.startMs,
      inTc: timecode(c.startMs),
      outTc: timecode(c.endMs),
      scriptSource: lines.length ? 'transcript' : fallback.length ? 'excerpt' : 'none',
      script,
      justification: c.justification,
      notes: c.notes,
      edited: c.edited,
    };
  });
  return { schema: EDIT_PLAN_SCHEMA, schemaVersion: EDIT_PLAN_SCHEMA_VERSION, exportedAt: doc.exportedAt, project: doc.project, client: doc.client, items };
}

const NOTICE = 'Plano de edição: este arquivo não contém vídeo. Os tempos vêm da transcrição e podem não coincidir com a mídia original; confira no seu editor. Sugestões são heurística textual.';
const dur = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const scriptText = (it: EditPlanItem) => it.script.map((l) => l.text).join(' ');
const srcLabel = (it: EditPlanItem) => ({ transcript: 'transcrição', excerpt: 'apenas trecho guardado', none: 'sem roteiro' })[it.scriptSource];

export function planToTxt(p: EditPlan): string {
  const out = [`${p.project.name} (${p.client.name})`, `Exportado: ${p.exportedAt}`, NOTICE, ''];
  for (const it of p.items) {
    out.push(`#${it.index} ${it.title}`, `IN ${it.inTc}  OUT ${it.outTc}  (${dur(it.durationMs)})`, `Roteiro (${srcLabel(it)}):`);
    for (const l of it.script) out.push(`  [${timecode(l.startMs)}] ${l.text}`);
    if (it.notes) out.push(`Notas: ${it.notes}`);
    out.push(`Motivo: ${it.justification}`, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

export function planToMd(p: EditPlan): string {
  const out = [`# Plano de edição — ${p.project.name}`, '', `Cliente: ${p.client.name} · Exportado: ${p.exportedAt}`, '', `> ${NOTICE}`, ''];
  for (const it of p.items) {
    out.push(`## ${it.index}. ${it.title}`, '', `- **IN:** \`${it.inTc}\` · **OUT:** \`${it.outTc}\` · **Duração:** ${dur(it.durationMs)}`, `- **Motivo:** ${it.justification}`);
    if (it.notes) out.push(`- **Notas:** ${it.notes}`);
    out.push('', `**Roteiro** (${srcLabel(it)}):`, '');
    for (const l of it.script) out.push(`- \`${timecode(l.startMs)}\` ${l.text}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

export function planToCsv(p: EditPlan): string {
  const rows: (string | number)[][] = [['index', 'clip_id', 'title', 'in', 'out', 'duration_s', 'in_ms', 'out_ms', 'script', 'script_source', 'justification', 'notes', 'edited']];
  for (const it of p.items) {
    rows.push([it.index, it.clipId, it.title, it.inTc, it.outTc, (it.durationMs / 1000).toFixed(3), it.inMs, it.outMs, scriptText(it), it.scriptSource, it.justification, it.notes ?? '', it.edited ? 'yes' : 'no']);
  }
  return `${rows.map((r) => r.map((c) => csvCell(c)).join(',')).join('\r\n')}\r\n`;
}

export const planToJson = (p: EditPlan) => `${JSON.stringify({ ...p, notice: NOTICE }, null, 2)}\n`;

export const serializePlan = (p: EditPlan, f: EditPlanFormat): string => ({ txt: planToTxt, md: planToMd, csv: planToCsv, json: planToJson })[f](p);

export const EDIT_PLAN_MIME: Record<EditPlanFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export const planFilename = (projectName: string, f: EditPlanFormat): string =>
  `${projectName.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project'}-edit-plan.${f}`;
