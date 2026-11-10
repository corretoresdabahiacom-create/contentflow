import { describe, expect, it } from 'vitest';
import {
  SubtitleParseError,
  TRANSCRIPT_LIMITS,
  formatTimestamp,
  parseSubtitles,
  parseTimestamp,
  segmentsToText,
  toSrt,
  toVtt,
  validateSegments,
} from '../index';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Olá, <i>mundo</i>.

2
00:00:03,500 --> 00:00:06,000
Segunda linha
continua aqui.
`;
const VTT = `WEBVTT

NOTE comentário

intro
00:01.000 --> 00:03.500 align:start position:0%
Olá, <c.yellow>mundo</c>.

00:03.500 --> 00:06.000
Segunda linha
continua aqui.
`;

describe('timestamps', () => {
  it('parse e format', () => {
    expect(parseTimestamp('00:01:02,345')).toBe(62_345);
    expect(parseTimestamp('01:02.3')).toBe(62_300);
    expect(parseTimestamp('1:00:00.000')).toBe(3_600_000);
    expect(parseTimestamp('00:61:00,000')).toBeNull();
    expect(parseTimestamp('abc')).toBeNull();
    expect(formatTimestamp(62_345)).toBe('00:01:02,345');
    expect(formatTimestamp(62_345, '.')).toBe('00:01:02.345');
  });
});

describe('parseSubtitles', () => {
  it('SRT', () => {
    const r = parseSubtitles(SRT);
    expect(r.format).toBe('srt');
    expect(r.segments).toEqual([
      { startMs: 1000, endMs: 3500, text: 'Olá, mundo.' },
      { startMs: 3500, endMs: 6000, text: 'Segunda linha continua aqui.' },
    ]);
  });
  it('VTT (cabeçalho, NOTE, identificador, settings, tags, tempo curto)', () => {
    const r = parseSubtitles(VTT);
    expect(r.format).toBe('vtt');
    expect(r.segments.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [1000, 3500, 'Olá, mundo.'],
      [3500, 6000, 'Segunda linha continua aqui.'],
    ]);
  });
  it('CRLF e BOM', () => {
    expect(parseSubtitles(`\uFEFF${SRT.replace(/\n/g, '\r\n')}`).segments).toHaveLength(2);
  });
  it('erros tipados', () => {
    const code = (s: string) => {
      try {
        parseSubtitles(s);
      } catch (e) {
        return (e as SubtitleParseError).code;
      }
    };
    expect(code('   ')).toBe('empty');
    expect(code('só texto sem tempo')).toBe('no_cues');
    expect(code('1\n00:00:05,000 --> 00:00:01,000\nx')).toBe('invalid_timing');
    expect(code('1\nxx --> yy\nx')).toBe('invalid_timing');
    const many = Array.from({ length: TRANSCRIPT_LIMITS.maxSegments + 1 }, (_, i) => `${i + 1}\n00:00:00,000 --> 00:00:01,000\nx`).join('\n\n');
    expect(code(many)).toBe('too_many_segments');
  });
});

describe('serialização', () => {
  const segs = parseSubtitles(SRT).segments;
  it('round-trip SRT e VTT', () => {
    expect(parseSubtitles(toSrt(segs)).segments).toEqual(segs);
    expect(parseSubtitles(toVtt(segs)).segments).toEqual(segs);
    expect(toVtt(segs).startsWith('WEBVTT\n\n00:00:01.000 --> ')).toBe(true);
    expect(toSrt(segs).startsWith('1\n00:00:01,000 --> 00:00:03,500\n')).toBe(true);
    expect(segmentsToText(segs)).toBe('Olá, mundo.\nSegunda linha continua aqui.');
  });
  it('validateSegments', () => {
    expect(validateSegments(segs)).toBe(true);
    expect(validateSegments([{ startMs: 5, endMs: 1, text: 'x' }])).toBe(false);
    expect(validateSegments([{ startMs: 5, endMs: 6, text: 'a' }, { startMs: 1, endMs: 2, text: 'b' }])).toBe(false);
    expect(validateSegments([{ startMs: 0, endMs: 1, text: '  ' }])).toBe(false);
    expect(validateSegments([{ startMs: 0.5, endMs: 1, text: 'x' }])).toBe(false);
  });
});
