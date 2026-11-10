import { and, eq, sql, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { makeDb } from '../db/client';
import { notifications, processingJobs, users, rateLimitCounters, sessions, sharedLinkAccessLogs, workspaceInvites } from '../db/schema';
import { getIntSetting } from '../lib/settings';
import { quotaOverview } from '../routes/admin';
import { purgeReports } from '../routes/reports';

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
  // Privacidade/espaço: logs de acesso de links compartilhados e convites encerrados não ficam para sempre.
  const logDays = await getIntSetting(db, 'shared_link.log_retention_days', 90);
  await db.delete(sharedLinkAccessLogs).where(lt(sharedLinkAccessLogs.accessedAt, now - logDays * 86_400_000));
  await db
    .delete(workspaceInvites)
    .where(or(lt(workspaceInvites.expiresAt, now - 30 * 86_400_000), and(isNotNull(workspaceInvites.revokedAt), lt(workspaceInvites.updatedAt, now - 30 * 86_400_000))));
  await purgeReports(db, now);
  await alertAdmins(db);
}

/** Avisa os admins globais (in-app) quando uma cota passa de 70% e de 90%. Um aviso por chave+nível enquanto não lido. */
export async function alertAdmins(db: ReturnType<typeof makeDb>) {
  const alerts = (await quotaOverview(db)).filter((q) => q.level === 'warn' || q.level === 'critical');
  if (alerts.length === 0) return;
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.isGlobalAdmin, 1), eq(users.status, 'active'))).all();
  for (const q of alerts) {
    const payload = JSON.stringify({ key: q.key, level: q.level, pct: q.pct });
    for (const a of admins) {
      const open = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, a.id), eq(notifications.kind, 'quota.alert'), sql`read_at is null and json_extract(payload_json,'$.key') = ${q.key} and json_extract(payload_json,'$.level') = ${q.level}`))
        .get();
      if (!open) await db.insert(notifications).values({ userId: a.id, kind: 'quota.alert', payloadJson: payload });
    }
  }
}
