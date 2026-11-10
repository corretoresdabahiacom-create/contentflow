/**
 * Calendário editorial: datas SEM horário e sem fuso. Um dia é guardado como a meia-noite UTC daquela
 * data (epoch em ms), e sempre lido com getters UTC. Assim "dia 15" é dia 15 para todos, em qualquer fuso.
 * O calendário só planeja: nada é publicado automaticamente.
 */
export const DAY_MS = 86_400_000;
export const CALENDAR_STATUSES = ['idea', 'producing', 'review', 'approved', 'scheduled', 'published'] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];
export const MIN_DAY_MS = Date.UTC(2020, 0, 1);
export const MAX_DAY_MS = Date.UTC(2100, 11, 31);

export const dayMs = (y: number, m0: number, d: number) => Date.UTC(y, m0, d);
export const isDayMs = (v: number) => Number.isInteger(v) && v % DAY_MS === 0 && v >= MIN_DAY_MS && v <= MAX_DAY_MS;
export const addDays = (ms: number, n: number) => ms + n * DAY_MS;
/** Dia (meia-noite UTC) que contém o instante. */
export const startOfDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
/** Hoje no fuso local do navegador, como dia sem horário. */
export const todayLocal = (now = new Date()) => dayMs(now.getFullYear(), now.getMonth(), now.getDate());

export function parseDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const ms = dayMs(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) && isDayMs(ms) ? ms : null;
}
export const formatDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Início da semana (domingo=0 por padrão; segunda=1) que contém o dia. */
export function startOfWeek(ms: number, weekStartsOn: 0 | 1 = 0): number {
  const dow = new Date(ms).getUTCDay();
  return ms - ((dow - weekStartsOn + 7) % 7) * DAY_MS;
}
export const weekDays = (ms: number, weekStartsOn: 0 | 1 = 0): number[] => {
  const s = startOfWeek(ms, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => s + i * DAY_MS);
};

/** Grade do mês: semanas completas (4 a 6 linhas × 7), incluindo dias dos meses vizinhos. */
export function monthGrid(year: number, month0: number, weekStartsOn: 0 | 1 = 0): number[][] {
  const first = dayMs(year, month0, 1);
  const last = dayMs(year, month0 + 1, 0);
  const start = startOfWeek(first, weekStartsOn);
  const end = startOfWeek(last, weekStartsOn) + 6 * DAY_MS;
  const weeks: number[][] = [];
  for (let d = start; d <= end; d += 7 * DAY_MS) weeks.push(Array.from({ length: 7 }, (_, i) => d + i * DAY_MS));
  return weeks;
}
export const inMonth = (ms: number, year: number, month0: number) => new Date(ms).getUTCFullYear() === year && new Date(ms).getUTCMonth() === month0;
