export type Segment = { startMs: number; endMs: number; text: string };

export const TRANSCRIPT_LIMITS = {
  maxChars: 200_000, // texto total (igual ao texto-fonte)
  maxSegments: 1_000, // cada segmento = 1 escrita no D1 (orçamento: 100 mil/dia)
  maxSegmentChars: 2_000,
  maxDurationMs: 6 * 60 * 60 * 1000,
} as const;

export class SubtitleParseError extends Error {
  constructor(
    public code: 'empty' | 'no_cues' | 'too_many_segments' | 'too_long' | 'invalid_timing',
  ) {
    super(code);
  }
}

// "00:01:02,345" | "01:02.345" | "1:02:03.4"
const TS = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;

export function parseTimestamp(s: string): number | null {
  const m = TS.exec(s.trim());
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  if (Number(min) > 59 || Number(sec) > 59) return null;
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return ((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(sec)) * 1000 + ms;
}

export function formatTimestamp(ms: number, sep: ',' | '.' = ','): string {
  const t = Math.max(0, Math.round(ms));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(t / 3_600_000))}:${p(Math.floor(t / 60_000) % 60)}:${p(Math.floor(t / 1000) % 60)}${sep}${p(t % 1000, 3)}`;
}

const stripTags = (s: string) =>
  s
    .replace(/<\/?[a-z][^>]*>/gi, '') // <i>, <b>, <c.color>, <00:00:01.000>
    .replace(/\{\\an?\d+\}/g, '') // {\an8}
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/** Lê SRT ou WebVTT (detecta pelo cabeçalho). Parser próprio, sem dependências. */
export function parseSubtitles(raw: string): { format: 'srt' | 'vtt'; segments: Segment[] } {
  const src = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!src) throw new SubtitleParseError('empty');
  const format = src.startsWith('WEBVTT') ? 'vtt' : 'srt';
  const segments: Segment[] = [];

  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue; // cabeçalho WEBVTT, NOTE, STYLE, número solto
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? '')) continue;
    const [a, rest] = (lines[i] as string).split('-->');
    const start = parseTimestamp(a ?? '');
    const end = parseTimestamp((rest ?? '').trim().split(/\s+/)[0] ?? ''); // ignora settings do VTT
    if (start === null || end === null || end < start) throw new SubtitleParseError('invalid_timing');
    const text = stripTags(lines.slice(i + 1).join(' ')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    segments.push({ startMs: start, endMs: end, text });
    if (segments.length > TRANSCRIPT_LIMITS.maxSegments) throw new SubtitleParseError('too_many_segments');
  }
  if (!segments.length) throw new SubtitleParseError('no_cues');
  const chars = segments.reduce((n, s) => n + s.text.length + 1, 0);
  if (chars > TRANSCRIPT_LIMITS.maxChars) throw new SubtitleParseError('too_long');
  return { format, segments };
}

export const segmentsToText = (segments: readonly Segment[]) => segments.map((s) => s.text).join('\n');

export function toSrt(segments: readonly Segment[]): string {
  return `${segments.map((s, i) => `${i + 1}\n${formatTimestamp(s.startMs)} --> ${formatTimestamp(s.endMs)}\n${s.text}`).join('\n\n')}\n`;
}

export function toVtt(segments: readonly Segment[]): string {
  return `WEBVTT\n\n${segments.map((s) => `${formatTimestamp(s.startMs, '.')} --> ${formatTimestamp(s.endMs, '.')}\n${s.text}`).join('\n\n')}\n`;
}

/** Valida segmentos vindos de qualquer origem (servidor e cliente usam a mesma regra). */
export function validateSegments(segments: readonly Segment[]): boolean {
  let prevStart = -1;
  for (const s of segments) {
    if (!Number.isInteger(s.startMs) || !Number.isInteger(s.endMs)) return false;
    if (s.startMs < 0 || s.endMs < s.startMs || s.endMs > TRANSCRIPT_LIMITS.maxDurationMs) return false;
    if (s.startMs < prevStart) return false; // ordem cronológica
    if (!s.text.trim() || s.text.length > TRANSCRIPT_LIMITS.maxSegmentChars) return false;
    prevStart = s.startMs;
  }
  return segments.length <= TRANSCRIPT_LIMITS.maxSegments;
}
