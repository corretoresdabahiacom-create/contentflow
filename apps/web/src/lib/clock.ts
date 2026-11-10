/** "1:05", "01:05.5", "0:01:05", "65" -> milissegundos; null se inválido. */
export function parseClock(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(?::\d{1,2}){0,2}(?:[.,]\d{1,3})?$/.test(s)) return null;
  const [main = '', frac] = s.replace(',', '.').split('.');
  const parts = main.split(':').map(Number);
  if (parts.slice(1).some((p) => p > 59)) return null;
  const sec = parts.reduce((acc, p) => acc * 60 + p, 0);
  return sec * 1000 + (frac ? Number(frac.padEnd(3, '0')) : 0);
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const formatDuration = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s`;
