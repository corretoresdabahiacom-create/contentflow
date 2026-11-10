import { describe, expect, it } from 'vitest';
import { CLIP_HEURISTIC_VERSION, suggestClips, validateSegments, type Segment } from '../index';

const mk = (lines: string[], step = 6000, gaps: Record<number, number> = {}): Segment[] => {
  let t = 0;
  return lines.map((text, i) => {
    t += gaps[i] ?? 0;
    const s = { startMs: t, endMs: t + step - 500, text };
    t += step;
    return s;
  });
};

const SOLAR = [
  'A energia solar cresceu muito no Brasil.',
  'Os painéis solares reduzem a conta de luz.',
  'A energia solar é limpa e os painéis duram vinte anos.',
  'Instalar painéis solares exige pouca manutenção.',
  'Muitos painéis solares já estão em telhados do Nordeste.',
  'A energia solar gera economia todo mês.',
  'Agora vamos falar de receitas de bolo.',
  'O bolo de cenoura leva três ovos e duas cenouras.',
  'Misture a farinha com o açúcar e a manteiga do bolo.',
  'Você sabe qual é o segredo da cobertura de chocolate?',
  'A cobertura de chocolate precisa de creme de leite e chocolate.',
  'Asse o bolo por quarenta minutos no forno quente.',
];

describe('suggestClips', () => {
  it('encontra a mudança de assunto e explica o motivo', () => {
    const segs = mk(SOLAR);
    expect(validateSegments(segs)).toBe(true);
    const clips = suggestClips(segs, 'pt', { minMs: 12_000, maxMs: 60_000 });
    expect(clips.length).toBeGreaterThan(0);
    const shift = clips.find((c) => c.signals.topicShift !== null);
    expect(shift).toBeDefined();
    expect(shift?.startMs).toBe(6 * 6000); // "Agora vamos falar de receitas de bolo."
    expect(shift?.justification).toMatch(/assunto muda/);
    for (const c of clips) expect(c.justification.length).toBeGreaterThan(10);
  });

  it('detecta pergunta, imperativo e número', () => {
    const segs = mk(SOLAR);
    const c = suggestClips(segs, 'pt', { minMs: 12_000, maxMs: 60_000 }).find((x) => x.signals.questions > 0);
    expect(c?.justification).toMatch(/pergunta/);
    expect(c?.signals.imperatives).toBeGreaterThan(0);
  });

  it('bordas sempre coincidem com início/fim de segmentos e respeitam duração', () => {
    const segs = mk(SOLAR);
    const starts = new Set(segs.map((s) => s.startMs));
    const ends = new Set(segs.map((s) => s.endMs));
    for (const c of suggestClips(segs, 'pt', { minMs: 12_000, maxMs: 40_000 })) {
      expect(starts.has(c.startMs)).toBe(true);
      expect(ends.has(c.endMs)).toBe(true);
      expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(12_000);
      expect(c.endMs - c.startMs).toBeLessThanOrEqual(40_000);
    }
  });

  it('pausa longa vira ponto de corte e é citada', () => {
    const segs = mk(SOLAR.slice(0, 6).map((t, i) => (i === 3 ? 'Você já pensou nisso? 3 motivos.' : t)), 6000, { 3: 5000 });
    const c = suggestClips(segs, 'pt', { minMs: 10_000, maxMs: 60_000 });
    expect(c.some((x) => x.signals.pauseMs !== null && /pausa/.test(x.justification))).toBe(true);
  });

  it('é determinística, ordenada, limitada por maxClips e em inglês usa justificativa em inglês', () => {
    const segs = mk(SOLAR);
    const a = suggestClips(segs, 'pt', { minMs: 12_000, maxMs: 30_000, maxClips: 2 });
    expect(a).toEqual(suggestClips(segs, 'pt', { minMs: 12_000, maxMs: 30_000, maxClips: 2 }));
    expect(a.length).toBeLessThanOrEqual(2);
    expect(a.map((x) => x.startMs)).toEqual([...a.map((x) => x.startMs)].sort((x, y) => x - y));
    const en = suggestClips(mk(['What is solar power?', 'Solar panels cut your bill by 30 percent.', 'Install them on the roof.', 'Cooking now: bake the cake for 40 minutes.', 'Mix flour and sugar in a bowl.', 'Do you like chocolate frosting?']), 'en', { minMs: 10_000, maxMs: 60_000 });
    expect(en.some((c) => /question|number|imperative|pause|shifts/.test(c.justification))).toBe(true);
  });

  it('casos vazios: <2 segmentos ou sem sinais', () => {
    expect(suggestClips([{ startMs: 0, endMs: 1000, text: 'oi' }], 'pt')).toEqual([]);
    expect(suggestClips(mk(['aaa bbb ccc.', 'aaa bbb ccc.']), 'pt', { minMs: 1000 })).toEqual([]);
  });

  it('nunca usa vocabulário de emoção ou viralidade', () => {
    const all = suggestClips(mk(SOLAR), 'pt', { minMs: 12_000 }).map((c) => c.justification).join(' ');
    expect(all).not.toMatch(/emo[çc]|viral|rosto|express[ãa]o facial|engaj/i);
    expect(CLIP_HEURISTIC_VERSION).toBe(1);
  });
});
