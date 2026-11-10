import { describe, expect, it } from 'vitest';
import { DAY_MS, addDays, dayMs, formatDay, isDayMs, monthGrid, parseDay, startOfWeek, weekDays } from './dates';

describe('dias sem fuso', () => {
  it('parse/format ida e volta e rejeita datas impossíveis', () => {
    expect(formatDay(parseDay('2026-11-10') as number)).toBe('2026-11-10');
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('2026-1-1')).toBeNull();
    expect(parseDay('2019-12-31')).toBeNull();
  });
  it('isDayMs exige meia-noite UTC dentro da faixa', () => {
    expect(isDayMs(dayMs(2026, 10, 10))).toBe(true);
    expect(isDayMs(dayMs(2026, 10, 10) + 1)).toBe(false);
    expect(isDayMs(0)).toBe(false);
    expect(isDayMs(1.5 * DAY_MS)).toBe(false);
  });
});

describe('semana e mês', () => {
  const d = dayMs(2026, 10, 10); // terça
  it('início da semana (dom e seg)', () => {
    expect(formatDay(startOfWeek(d, 0))).toBe('2026-11-08');
    expect(formatDay(startOfWeek(d, 1))).toBe('2026-11-09');
    expect(weekDays(d, 0).map(formatDay)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
  });
  it('grade de novembro/2026 (1º é domingo) tem 5 semanas, de 1/nov a 5/dez', () => {
    const g = monthGrid(2026, 10, 0);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g).toHaveLength(5);
    expect(formatDay(g[0]?.[0] as number)).toBe('2026-11-01');
    expect(formatDay(g[4]?.[6] as number)).toBe('2026-12-05');
  });
  it('outubro de 2026 (1º é quinta) começa em 27/set e tem 5 semanas', () => {
    const g = monthGrid(2026, 9, 0);
    expect(formatDay(g[0]?.[0] as number)).toBe('2026-09-27');
    expect(g).toHaveLength(5);
  });
  it('fevereiro de 2026 (começa no domingo) tem 4 semanas', () => {
    const g = monthGrid(2026, 1, 0);
    expect(g).toHaveLength(4);
    expect(formatDay(g[0]?.[0] as number)).toBe('2026-02-01');
  });
  it('addDays atravessa mudança de mês', () => {
    expect(formatDay(addDays(dayMs(2026, 0, 31), 1))).toBe('2026-02-01');
  });
});
