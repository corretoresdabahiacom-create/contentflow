import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@contentflow/shared';
import type { Db } from '../db/client';
import { HttpError } from './http';

/** Contador por janela fixa em D1 (1 escrita por tentativa; orçamento: 100 mil escritas/dia). */
export async function hitRateLimit(db: Db, key: string, max: number, windowS: number) {
  const now = Date.now();
  const windowStart = Math.floor(now / (windowS * 1000)) * windowS * 1000;
  const row = await db.get<{ count: number }>(sql`
    INSERT INTO rate_limit_counters (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
    RETURNING count`);
  if (row && row.count > max) {
    const retry = Math.max(1, Math.ceil((windowStart + windowS * 1000 - now) / 1000));
    throw new HttpError(
      429,
      ERROR_CODES.RATE_LIMITED,
      'Too many attempts. Try again later.',
      undefined,
      { 'Retry-After': String(retry) },
    );
  }
}
