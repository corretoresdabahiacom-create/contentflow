import { describe, expect, it } from 'vitest';
import { audioExtOk, canRunWasm, chunksToSegments, isMobile, wasmEstimate, wasmGate } from './wasm';

const ok = { mobile: false, deviceMemoryGb: 8, durationSec: 120, hasWasm: true, hasAudioContext: true };

describe('wasmGate', () => {
  it('desktop com recursos: liberado', () => {
    const g = wasmGate(ok);
    expect(g).toEqual({ blocked: [], overridable: [] });
    expect(canRunWasm(g, false)).toBe(true);
  });
  it('mobile bloqueado por padrão; só roda com aceite explícito', () => {
    const g = wasmGate({ ...ok, mobile: true });
    expect(g.overridable).toContain('mobile');
    expect(canRunWasm(g, false)).toBe(false);
    expect(canRunWasm(g, true)).toBe(true);
  });
  it('pouca memória exige aceite; áudio > 10 min ou sem WASM nunca roda', () => {
    expect(canRunWasm(wasmGate({ ...ok, deviceMemoryGb: 2 }), false)).toBe(false);
    expect(canRunWasm(wasmGate({ ...ok, deviceMemoryGb: 2 }), true)).toBe(true);
    const long = wasmGate({ ...ok, durationSec: 601 });
    expect(long.blocked).toEqual(['too_long']);
    expect(canRunWasm(long, true)).toBe(false);
    expect(canRunWasm(wasmGate({ ...ok, hasWasm: false }), true)).toBe(false);
    expect(canRunWasm(wasmGate({ ...ok, durationSec: null }), true)).toBe(false);
    expect(canRunWasm(wasmGate({ ...ok, durationSec: 600 }), false)).toBe(true);
  });
  it('memória desconhecida (Safari/Firefox) não bloqueia', () => {
    expect(wasmGate({ ...ok, deviceMemoryGb: undefined }).overridable).toEqual([]);
  });
});

describe('utilitários', () => {
  it('detecta mobile, inclusive iPadOS', () => {
    expect(isMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(true);
    expect(isMobile('Mozilla/5.0 (Linux; Android 14) Mobile')).toBe(true);
    expect(isMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isMobile('Mozilla/5.0 (X11; Linux x86_64) Chrome/120')).toBe(false);
  });
  it('extensões de áudio aceitas', () => {
    for (const n of ['a.mp3', 'a.WAV', 'a.m4a', 'a.ogg']) expect(audioExtOk(n)).toBe(true);
    for (const n of ['a.mp4', 'a.flac', 'a']) expect(audioExtOk(n)).toBe(false);
  });
  it('estimativa cresce com a duração e declara RAM', () => {
    expect(wasmEstimate(600).minutes[1]).toBeGreaterThan(wasmEstimate(60).minutes[1]);
    expect(wasmEstimate(60).ramGb).toBe(4);
  });
  it('chunksToSegments: ordena, preenche fim nulo e descarta vazios', () => {
    const s = chunksToSegments(
      [
        { text: ' Olá  mundo ', timestamp: [0, 2.5] },
        { text: '   ', timestamp: [2.5, 3] },
        { text: 'Fim', timestamp: [2.0, null] },
      ],
      10,
    );
    expect(s).toEqual([
      { startMs: 0, endMs: 2500, text: 'Olá mundo' },
      { startMs: 2000, endMs: 10_000, text: 'Fim' },
    ]);
    // início fora de ordem é corrigido para nunca recuar
    expect(chunksToSegments([{ text: 'a', timestamp: [5, 6] }, { text: 'b', timestamp: [1, 2] }], 10).map((x) => x.startMs)).toEqual([5000, 5000]);
  });
});
