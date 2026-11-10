import type { Db } from '../db/client';
import { ERROR_CODES } from '@contentflow/shared';
import { HttpError } from './http';
import { getIntSetting } from './settings';

export async function quota(db: Db, key: string, fallback: number, current: number, what: string) {
  const limit = await getIntSetting(db, key, fallback);
  if (current >= limit) {
    throw new HttpError(409, ERROR_CODES.QUOTA_EXCEEDED, `Quota reached: ${what} (limit ${limit}).`, 'quota');
  }
}

export const countOf = async (q: Promise<{ n: number } | undefined>) => (await q)?.n ?? 0;
