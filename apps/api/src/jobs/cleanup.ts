import { and, inArray, lt } from 'drizzle-orm';
import { makeDb } from '../db/client';
import { processingJobs, rateLimitCounters, sessions } from '../db/schema';
import { getIntSetting } from '../lib/settings';

/** Cron horário. Poucos comandos: cabe nos 10 ms de CPU do Free. */
export async function cleanup(d1: D1Database, now = Date.now()) {
  const db = makeDb(d1);
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(rateLimitCounters).where(lt(rateLimitCounters.windowStart, now - 86_400_000));
  // Jobs de transcrição abandonados (aba fechada no meio do WASM/revisão): cancela e apaga o rascunho.
  const staleMs = (await getIntSetting(db, 'job.stale_after_s', 604_800)) * 1000;
  await db
    .update(processingJobs)
    .set({ status: 'canceled', errorCode: 'stale', payloadJson: null, updatedAt: now })
    .where(
      and(
        inArray(processingJobs.status, ['submitted', 'validating', 'waiting_review', 'running']),
        lt(processingJobs.updatedAt, now - staleMs),
      ),
    );
}
