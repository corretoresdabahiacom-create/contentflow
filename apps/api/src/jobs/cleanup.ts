import { lt } from 'drizzle-orm';
import { makeDb } from '../db/client';
import { rateLimitCounters, sessions } from '../db/schema';

/** Cron horário. Só 2 DELETEs: cabe nos 10 ms de CPU do Free. */
export async function cleanup(d1: D1Database, now = Date.now()) {
  const db = makeDb(d1);
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(rateLimitCounters).where(lt(rateLimitCounters.windowStart, now - 86_400_000));
}
