import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { ERROR_CODES, canRevoke } from '@contentflow/shared';
import type { AppEnv } from '../context';
import {
  auditLogs, contentOutputs, featureFlags, notifications, processingJobs, reports,
  sharedLinkOutputs, sharedLinks, systemSettings, users, workspaceMembers, workspaces,
} from '../db/schema';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/http';
import { getIntSetting } from '../lib/settings';
import { requireAuth, requireGlobalAdmin } from '../middleware';

/**
 * Painel de administração global. REGRA: só metadados e contagens. Nunca texto-fonte, transcrições,
 * corpo de outputs, brand kit nem e-mails de quem denuncia. A única "amostra" é o início (200 caracteres)
 * de outputs de um link compartilhado que foi denunciado (já era público para quem tinha o link).
 */
const notFound = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
const bad = () => new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
const parse = async <T extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, s: T): Promise<z.infer<T>> => {
  const p = s.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw bad();
  return p.data;
};

/** Flags que o admin pode ligar. As outras estão travadas por regra (R2, R7) e a UI mostra o motivo. */
export const FLAG_LOCKS: Record<string, string> = {
  monetization_enabled: 'R7: pagamentos não existem neste produto.',
  ai_external_enabled: 'R2: nenhum adaptador de IA externa existe; ligar a flag não faria nada.',
};

/** Chaves de configuração editáveis e limites aceitos (evita valores absurdos). */
const SETTING_PREFIXES = ['quota.', 'rate_limit.', 'job.', 'report.', 'shared_link.'];

/** Cota → como medir o maior uso atual. Quotas sem medidor aparecem só com o limite. */
const USAGE: Record<string, () => ReturnType<typeof sql<number>>> = {
  'quota.projects_per_workspace': () => sql<number>`(select coalesce(max(n),0) from (select count(*) n from projects group by workspace_id))`,
  'quota.clients_per_workspace': () => sql<number>`(select coalesce(max(n),0) from (select count(*) n from clients group by workspace_id))`,
  'quota.members_per_workspace': () => sql<number>`(select coalesce(max(n),0) from (select count(*) n from workspace_members group by workspace_id))`,
  'quota.calendar_per_workspace': () => sql<number>`(select coalesce(max(n),0) from (select count(*) n from editorial_calendar group by workspace_id))`,
  'quota.outputs_per_project': () => sql<number>`(select coalesce(max(n),0) from (select count(*) n from content_outputs group by project_id))`,
  'quota.clips_per_project': () => sql<number>`(select coalesce(max(n),0) from (select count(*) n from clip_suggestions group by project_id))`,
};

export async function quotaOverview(db: AppEnv['Variables']['db']) {
  const rows = await db.select().from(systemSettings).where(sql`key like 'quota.%'`).all();
  const out = [] as { key: string; limit: number; peak: number | null; pct: number | null; level: 'ok' | 'warn' | 'critical' | 'unmeasured' }[];
  for (const r of rows) {
    const limit = Number.parseInt(r.value, 10);
    const m = USAGE[r.key];
    const peak = m ? ((await db.get<{ v: number }>(sql`select ${m()} as v`))?.v ?? 0) : null;
    const pct = peak === null || !(limit > 0) ? null : Math.round((peak / limit) * 100);
    out.push({ key: r.key, limit, peak, pct, level: pct === null ? 'unmeasured' : pct >= 90 ? 'critical' : pct >= 70 ? 'warn' : 'ok' });
  }
  return out;
}

const COUNT_TABLES = ['users', 'workspaces', 'workspace_members', 'clients', 'projects', 'source_files', 'processing_jobs', 'transcripts', 'content_outputs', 'clip_suggestions', 'editorial_calendar', 'approvals', 'shared_links', 'shared_link_access_logs', 'audit_logs', 'reports', 'sessions', 'rate_limit_counters'] as const;

export function adminRoutes() {
  const r = new Hono<AppEnv>();
  r.use('*', requireAuth, requireGlobalAdmin);

  r.get('/overview', async (c) => {
    const db = c.get('db');
    const now = Date.now();
    const tables: Record<string, number> = {};
    for (const t of COUNT_TABLES) tables[t] = (await db.get<{ n: number }>(sql.raw(`select count(*) as n from ${t}`)))?.n ?? 0;
    const stuckMs = (await getIntSetting(db, 'job.stuck_after_s', 3600)) * 1000;
    const stuck = (await db.get<{ n: number }>(sql`select count(*) n from processing_jobs where status in ('submitted','validating','running') and updated_at < ${now - stuckMs}`))?.n ?? 0;
    const failed7 = (await db.get<{ n: number }>(sql`select count(*) n from processing_jobs where status = 'failed' and updated_at > ${now - 7 * 86_400_000}`))?.n ?? 0;
    const openReports = (await db.get<{ n: number }>(sql`select count(*) n from reports where status in ('open','reviewing')`))?.n ?? 0;
    const files = await db.get<{ n: number; bytes: number }>(sql`select count(*) n, coalesce(sum(size_bytes),0) bytes from source_files where status != 'deleted'`);
    const quotas = await quotaOverview(db);
    return c.json({
      tables,
      jobs: { stuck, failedLast7d: failed7 },
      sourceFiles: { count: files?.n ?? 0, bytes: files?.bytes ?? 0, storage: 'sem armazenamento de arquivos (R2 excluído): só metadados' },
      openReports,
      quotas,
      alerts: quotas.filter((q) => q.level === 'warn' || q.level === 'critical').map((q) => ({ key: q.key, level: q.level, pct: q.pct })),
      // R4: sem token de API da Cloudflare no servidor, estes números não são mensuráveis daqui.
      external: {
        workersRequests: 'unavailable',
        d1Reads: 'unavailable',
        d1Writes: 'unavailable',
        r2: 'not_applicable',
        note: 'Consulte o painel da Cloudflare (Workers & D1 > Metrics). Não guardamos token de API.',
      },
    });
  });

  r.get('/users', async (c) => {
    const rows = await c.get('db').all<{ id: string; email: string; status: string; is_global_admin: number; created_at: number; workspaces: number }>(sql`
      select u.id, u.email, u.status, u.is_global_admin, u.created_at,
        (select count(*) from workspace_members m where m.user_id = u.id) as workspaces
      from users u order by u.created_at desc limit 200`);
    return c.json({ users: rows.map((u) => ({ id: u.id, email: u.email, status: u.status, isGlobalAdmin: u.is_global_admin === 1, createdAt: u.created_at, workspaces: u.workspaces })) });
  });

  r.patch('/users/:id', async (c) => {
    const p = await parse(c, z.object({ status: z.enum(['active', 'suspended']) }));
    const db = c.get('db');
    const id = c.req.param('id');
    if (id === c.get('user').id) throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'You cannot change your own status.');
    const target = await db.select({ id: users.id, isAdmin: users.isGlobalAdmin }).from(users).where(eq(users.id, id)).get();
    if (!target) throw notFound();
    if (target.isAdmin === 1) throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'Global admins cannot be suspended here.');
    await db.update(users).set({ status: p.status, updatedAt: Date.now() }).where(eq(users.id, id));
    await audit(db, { action: `admin.user.${p.status}`, userId: c.get('user').id, targetKind: 'user', targetId: id });
    return c.json({ id, status: p.status });
  });

  r.get('/workspaces', async (c) => {
    const rows = await c.get('db').all<{ id: string; name: string; kind: string; created_at: number; members: number; clients: number; projects: number; links: number }>(sql`
      select w.id, w.name, w.kind, w.created_at,
        (select count(*) from workspace_members m where m.workspace_id = w.id) members,
        (select count(*) from clients k where k.workspace_id = w.id) clients,
        (select count(*) from projects p where p.workspace_id = w.id) projects,
        (select count(*) from shared_links s where s.workspace_id = w.id and s.revoked_at is null and s.expires_at > ${Date.now()}) links
      from workspaces w order by w.created_at desc limit 200`);
    return c.json({ workspaces: rows.map((w) => ({ id: w.id, name: w.name, kind: w.kind, createdAt: w.created_at, members: w.members, clients: w.clients, projects: w.projects, activeLinks: w.links })) });
  });

  r.get('/projects', async (c) => {
    // metadados: nome do projeto é rótulo dado pelo usuário; nenhum conteúdo
    const rows = await c.get('db').all<{ id: string; workspace_id: string; status: string; created_at: number; files: number; bytes: number; outputs: number }>(sql`
      select p.id, p.workspace_id, p.status, p.created_at,
        (select count(*) from source_files f where f.project_id = p.id and f.status != 'deleted') files,
        (select coalesce(sum(size_bytes),0) from source_files f where f.project_id = p.id and f.status != 'deleted') bytes,
        (select count(*) from content_outputs o where o.project_id = p.id) outputs
      from projects p order by p.created_at desc limit 200`);
    return c.json({ projects: rows.map((p) => ({ id: p.id, workspaceId: p.workspace_id, status: p.status, createdAt: p.created_at, sourceFiles: p.files, bytes: p.bytes, outputs: p.outputs })) });
  });

  r.get('/jobs', async (c) => {
    const db = c.get('db');
    const filter = c.req.query('filter') === 'failed' ? 'failed' : 'stuck';
    const stuckMs = (await getIntSetting(db, 'job.stuck_after_s', 3600)) * 1000;
    const where = filter === 'failed'
      ? eq(processingJobs.status, 'failed')
      : and(inArray(processingJobs.status, ['submitted', 'validating', 'running']), lt(processingJobs.updatedAt, Date.now() - stuckMs));
    const rows = await db
      .select({ id: processingJobs.id, workspaceId: processingJobs.workspaceId, projectId: processingJobs.projectId, kind: processingJobs.kind, status: processingJobs.status, attempts: processingJobs.attempts, errorCode: processingJobs.errorCode, updatedAt: processingJobs.updatedAt })
      .from(processingJobs).where(where).orderBy(desc(processingJobs.updatedAt)).limit(100).all();
    return c.json({ filter, jobs: rows });
  });

  r.post('/jobs/:id/cancel', async (c) => {
    const db = c.get('db');
    const row = await db
      .update(processingJobs)
      .set({ status: 'canceled', errorCode: 'admin_canceled', payloadJson: null, updatedAt: Date.now() })
      .where(and(eq(processingJobs.id, c.req.param('id')), inArray(processingJobs.status, ['submitted', 'validating', 'running', 'waiting_review'])))
      .returning({ id: processingJobs.id, workspaceId: processingJobs.workspaceId })
      .get();
    if (!row) throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'Job is not active.');
    await audit(db, { action: 'admin.job.cancel', userId: c.get('user').id, workspaceId: row.workspaceId, targetKind: 'job', targetId: row.id });
    return c.json({ id: row.id, status: 'canceled' });
  });

  // ---- flags e configuração ----
  r.get('/flags', async (c) => {
    const rows = await c.get('db').select().from(featureFlags).all();
    return c.json({ flags: rows.map((f) => ({ key: f.key, enabled: f.enabled === 1, description: f.description, locked: FLAG_LOCKS[f.key] ?? null })) });
  });

  r.patch('/flags/:key', async (c) => {
    const p = await parse(c, z.object({ enabled: z.boolean() }));
    const db = c.get('db');
    const key = c.req.param('key');
    const lock = FLAG_LOCKS[key];
    if (lock) throw new HttpError(409, ERROR_CODES.INVALID_STATE, lock);
    const row = await db.update(featureFlags).set({ enabled: p.enabled ? 1 : 0, updatedAt: Date.now() }).where(eq(featureFlags.key, key)).returning({ key: featureFlags.key }).get();
    if (!row) throw notFound();
    await audit(db, { action: 'admin.flag.set', userId: c.get('user').id, targetKind: 'flag', targetId: key, metadata: { enabled: p.enabled } });
    return c.json({ key, enabled: p.enabled });
  });

  r.get('/settings', async (c) => {
    const rows = await c.get('db').select().from(systemSettings).orderBy(systemSettings.key).all();
    return c.json({ settings: rows.filter((s) => SETTING_PREFIXES.some((p) => s.key.startsWith(p))).map((s) => ({ key: s.key, value: Number.parseInt(s.value, 10) })), quotas: await quotaOverview(c.get('db')) });
  });

  r.patch('/settings/:key', async (c) => {
    const p = await parse(c, z.object({ value: z.number().int().min(1).max(10_000_000) }));
    const db = c.get('db');
    const key = c.req.param('key');
    if (!SETTING_PREFIXES.some((x) => key.startsWith(x))) throw notFound();
    const row = await db.update(systemSettings).set({ value: String(p.value), updatedAt: Date.now() }).where(eq(systemSettings.key, key)).returning({ key: systemSettings.key }).get();
    if (!row) throw notFound(); // só chaves existentes: nada de criar configuração arbitrária
    await audit(db, { action: 'admin.setting.set', userId: c.get('user').id, targetKind: 'setting', targetId: key, metadata: { value: p.value } });
    return c.json({ key, value: p.value });
  });

  r.get('/audit', async (c) => {
    const rows = await c.get('db').select({ id: auditLogs.id, action: auditLogs.action, userId: auditLogs.userId, workspaceId: auditLogs.workspaceId, targetKind: auditLogs.targetKind, targetId: auditLogs.targetId, createdAt: auditLogs.createdAt }).from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100).all();
    return c.json({ events: rows });
  });

  // ---- moderação ----
  r.get('/reports', async (c) => {
    const status = c.req.query('status');
    const q = c.get('db').select().from(reports).orderBy(desc(reports.urgent), desc(reports.createdAt)).limit(100);
    const rows = await (status && ['open', 'reviewing', 'resolved', 'dismissed'].includes(status) ? q.where(eq(reports.status, status)) : q).all();
    return c.json({ reports: rows.map((x) => ({ id: x.id, reason: x.reason, urgent: x.urgent === 1, status: x.status, targetKind: x.targetKind, hasTarget: !!x.targetId, ownerNotifiedAt: x.ownerNotifiedAt, createdAt: x.createdAt, resolution: x.resolution })) });
  });

  r.get('/reports/:id', async (c) => {
    const db = c.get('db');
    const x = await db.select().from(reports).where(eq(reports.id, c.req.param('id'))).get();
    if (!x) throw notFound();
    let target: unknown = null;
    if (x.targetKind === 'shared_link' && x.targetId) {
      const link = await db.select().from(sharedLinks).where(eq(sharedLinks.id, x.targetId)).get();
      if (link) {
        const ws = await db.select({ name: workspaces.name, kind: workspaces.kind }).from(workspaces).where(eq(workspaces.id, link.workspaceId)).get();
        const outs = await db
          .select({ id: contentOutputs.id, channel: contentOutputs.channel, title: contentOutputs.title, body: contentOutputs.body })
          .from(sharedLinkOutputs).innerJoin(contentOutputs, eq(contentOutputs.id, sharedLinkOutputs.outputId))
          .where(eq(sharedLinkOutputs.linkId, link.id)).limit(20).all();
        target = {
          linkId: link.id, workspaceId: link.workspaceId, workspaceName: ws?.name ?? null, workspaceKind: ws?.kind ?? null,
          active: link.revokedAt === null && link.expiresAt > Date.now(), revokedAt: link.revokedAt, expiresAt: link.expiresAt,
          samples: outs.map((o) => ({ id: o.id, channel: o.channel, title: o.title, sample: o.body.slice(0, 200) })),
        };
      }
    }
    return c.json({
      id: x.id, reason: x.reason, urgent: x.urgent === 1, status: x.status, details: x.details, hasContact: !!x.reporterContact,
      ownerNotifiedAt: x.ownerNotifiedAt, resolution: x.resolution, resolutionNote: x.resolutionNote, createdAt: x.createdAt,
      canRevoke: canRevoke({ urgent: x.urgent === 1, ownerNotifiedAt: x.ownerNotifiedAt }), target,
    });
  });

  /** Avisa o(s) dono(s) do workspace. Ação segura e repetível: não remove nada. */
  r.post('/reports/:id/notify-owner', async (c) => {
    const db = c.get('db');
    const x = await db.select().from(reports).where(eq(reports.id, c.req.param('id'))).get();
    if (!x) throw notFound();
    if (!x.targetWorkspaceId || !x.targetId) throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'This report has no known owner to notify.');
    if (x.status === 'resolved' || x.status === 'dismissed') throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'Report is closed.');
    const owners = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, x.targetWorkspaceId), eq(workspaceMembers.role, 'owner'))).all();
    const now = Date.now();
    const payload = JSON.stringify({ reportId: x.id, reason: x.reason, linkId: x.targetId, stage: 'notice' });
    await db.batch([
      ...owners.map((o) => db.insert(notifications).values({ userId: o.userId, workspaceId: x.targetWorkspaceId, kind: 'moderation.notice', payloadJson: payload })),
      db.update(reports).set({ ownerNotifiedAt: now, status: 'reviewing', reviewerId: c.get('user').id, updatedAt: now }).where(eq(reports.id, x.id)),
    ] as never);
    await audit(db, { action: 'admin.report.notify', userId: c.get('user').id, workspaceId: x.targetWorkspaceId, targetKind: 'report', targetId: x.id, metadata: { owners: owners.length } });
    return c.json({ notified: owners.length });
  });

  /** Decisão final. Remover = revogar o link (irreversível: R6 exige confirmação explícita). */
  r.post('/reports/:id/resolve', async (c) => {
    const p = await parse(c, z.object({ action: z.enum(['dismiss', 'revoke_link']), note: z.string().trim().max(1000).optional(), confirm: z.literal(true).optional() }));
    const db = c.get('db');
    const x = await db.select().from(reports).where(eq(reports.id, c.req.param('id'))).get();
    if (!x) throw notFound();
    if (x.status === 'resolved' || x.status === 'dismissed') throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'Report is closed.');
    const now = Date.now();
    const base = { reviewerId: c.get('user').id, resolvedAt: now, resolutionNote: p.note ?? null, updatedAt: now };
    if (p.action === 'dismiss') {
      await db.update(reports).set({ ...base, status: 'dismissed', resolution: 'dismissed' }).where(eq(reports.id, x.id));
    } else {
      if (p.confirm !== true) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Explicit confirmation is required.');
      if (x.targetKind !== 'shared_link' || !x.targetId || !x.targetWorkspaceId) throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'This report has no link to revoke.');
      if (!canRevoke({ urgent: x.urgent === 1, ownerNotifiedAt: x.ownerNotifiedAt })) {
        throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'Notify the owner before removing, unless the report is urgent.');
      }
      const owners = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, x.targetWorkspaceId), eq(workspaceMembers.role, 'owner'))).all();
      const payload = JSON.stringify({ reportId: x.id, reason: x.reason, linkId: x.targetId, stage: 'removed' });
      await db.batch([
        db.update(sharedLinks).set({ revokedAt: now, updatedAt: now }).where(and(eq(sharedLinks.id, x.targetId), eq(sharedLinks.workspaceId, x.targetWorkspaceId))),
        db.update(reports).set({ ...base, status: 'resolved', resolution: 'link_revoked' }).where(eq(reports.id, x.id)),
        ...owners.map((o) => db.insert(notifications).values({ userId: o.userId, workspaceId: x.targetWorkspaceId as string, kind: 'moderation.removed', payloadJson: payload })),
      ] as never);
    }
    await audit(db, { action: `admin.report.${p.action}`, userId: c.get('user').id, workspaceId: x.targetWorkspaceId, targetKind: 'report', targetId: x.id, metadata: { urgent: x.urgent === 1 } });
    return c.json({ id: x.id, status: p.action === 'dismiss' ? 'dismissed' : 'resolved' });
  });

  return r;
}
