import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, parseClock } from './clock';

describe('clock', () => {
  it('parse', () => {
    expect(parseClock('1:05')).toBe(65_000);
    expect(parseClock('01:05.5')).toBe(65_500);
    expect(parseClock('0:01:05')).toBe(65_000);
    expect(parseClock('65')).toBe(65_000);
    expect(parseClock(' 2:00,25 ')).toBe(120_250);
    for (const bad of ['', 'abc', '1:75', '1:2:3:4', '-5', '1:05:']) expect(parseClock(bad), bad).toBeNull();
  });
  it('format', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatDuration(30_000)).toBe('30 s');
    expect(formatDuration(1_500)).toBe('1.5 s');
  });
});
