import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { systemSettings } from '../db/schema';

export async function getIntSetting(db: Db, key: string, fallback: number): Promise<number> {
  const row = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).get();
  const n = row ? Number.parseInt(row.value, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}
