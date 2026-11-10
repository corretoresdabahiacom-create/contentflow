import type { Analysis } from './analyze';
import { toSrt, toVtt, type Segment } from '../transcript/subtitles';

export const EXPORT_SCHEMA = 'contentflow.export' as const;
export const EXPORT_SCHEMA_VERSION = 1 as const;
export const EXPORT_FORMATS = ['txt', 'md', 'srt', 'vtt', 'csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportOutput = {
  id: string;
  channel: string;
  kind: string;
  title: string | null;
  body: string;
  version: number;
  sourceKind: 'template' | 'wasm' | 'ai_external';
  updatedAt: number;
};

export type ExportClip = {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  justification: string;
  excerpt: string;
  notes: string | null;
  edited: boolean;
  version: number;
};

export type ExportDoc = {
  schema: typeof EXPORT_SCHEMA;
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  project: { id: string; name: string };
  client: { id: string; name: string };
  source: { kind: string; filename: string | null; chars: number } | null;
  analysis: Analysis | null;
  outputs: ExportOutput[];
  /** Opcionais (adicionados na Fase 4 sem mudar o schemaVersion). */
  clips?: ExportClip[];
  transcript?: { id: string; origin: string; language: string | null; segments: Segment[] } | null;
};

export const toJson = (d: ExportDoc) => `${JSON.stringify(d, null, 2)}\n`;

export function toTxt(d: ExportDoc): string {
  const parts = [`${d.project.name} (${d.client.name})`, `Exported: ${d.exportedAt}`, ''];
  for (const o of d.outputs) parts.push(`--- ${o.channel}/${o.kind} [${o.sourceKind}] v${o.version} ---`, o.body, '');
  for (const c of d.clips ?? []) parts.push(`--- clip ${mmss(c.startMs)}-${mmss(c.endMs)}: ${c.title} ---`, c.justification, c.notes ?? '', '');
  return `${parts.join('\n').trimEnd()}\n`;
}

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function toMd(d: ExportDoc): string {
  const parts = [`# ${d.project.name}`, '', `Client: ${d.client.name} · Exported: ${d.exportedAt}`, ''];
  if (d.analysis) {
    parts.push('## Analysis', '', `- Language: ${d.analysis.language}`, `- Keywords: ${d.analysis.keywords.join(', ')}`, '');
  }
  for (const o of d.outputs) {
    parts.push(`## ${o.channel} · ${o.kind}`, '', `_source: ${o.sourceKind} · version ${o.version}_`, '', o.body, '');
  }
  if (d.clips?.length) {
    parts.push('## Clip suggestions (text heuristic, not video analysis)', '');
    for (const c of d.clips) parts.push(`### ${mmss(c.startMs)}–${mmss(c.endMs)} · ${c.title}`, '', `- Why: ${c.justification}`, ...(c.notes ? [`- Notes: ${c.notes}`] : []), '', `> ${c.excerpt}`, '');
  }
  return `${parts.join('\n').trimEnd()}\n`;
}

/** CSV (RFC 4180) com proteção contra injeção de fórmula: células iniciadas por = + - @ ganham apóstrofo. */
export function csvCell(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(d: ExportDoc): string {
  const rows = [['id', 'channel', 'kind', 'title', 'body', 'version', 'source_kind']];
  for (const o of d.outputs) rows.push([o.id, o.channel, o.kind, o.title ?? '', o.body, String(o.version), o.sourceKind]);
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** SRT/VTT exportam a transcrição com timestamps do projeto; vazio se não houver (a UI desabilita). */
export const hasSubtitles = (d: ExportDoc) => (d.transcript?.segments.length ?? 0) > 0;
export const toSrtDoc = (d: ExportDoc) => toSrt(d.transcript?.segments ?? []);
export const toVttDoc = (d: ExportDoc) => toVtt(d.transcript?.segments ?? []);

export function serialize(d: ExportDoc, f: ExportFormat): string {
  return { txt: toTxt, md: toMd, srt: toSrtDoc, vtt: toVttDoc, csv: toCsv, json: toJson }[f](d);
}

export const EXPORT_MIME: Record<ExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  srt: 'application/x-subrip;charset=utf-8',
  vtt: 'text/vtt;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export const exportFilename = (projectName: string, f: ExportFormat): string =>
  `${projectName.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project'}.${f}`;
