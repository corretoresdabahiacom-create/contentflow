import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  ERROR_CODES,
  REPORT_LIMITS,
  REPORT_REASONS,
  URGENT_REASONS,
  extractShareToken,
} from '@contentflow/shared';
import type { AppEnv, Deps } from '../context';
import { notifications, reports, sharedLinks } from '../db/schema';
import { sha256Hex } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { hitRateLimit } from '../lib/ratelimit';
import { getIntSetting } from '../lib/settings';
import { verifyTurnstile } from '../lib/turnstile';
import { requireAuth } from '../middleware';

const body = z.object({
  link: z.string().trim().min(1).max(REPORT_LIMITS.link),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(REPORT_LIMITS.details).optional(),
  contact: z.string().trim().max(REPORT_LIMITS.contact).optional(),
  turnstileToken: z.string().min(1).max(2100),
});

/**
 * Denúncia pública (/report). Sempre responde igual (201) para não revelar se o link existe.
 * Proteções: Turnstile (falha fechada), rate limit por IP, nenhum dado do denunciante além do que ele digita
 * (contato é opcional) e o hash do IP para abuso.
 */
export function reportPublicRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.post('/', async (c) => {
    const p = body.safeParse(await c.req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
    const db = c.get('db');
    const ip = c.req.header('CF-Connecting-IP') ?? null;
    const ipHash = ip ? (await sha256Hex(`${c.env.SESSION_PEPPER ?? ''}:${ip}`)).slice(0, 32) : null;
    const max = await getIntSetting(db, 'rate_limit.report.max', 5);
    const win = await getIntSetting(db, 'rate_limit.report.window_s', 3600);
    await hitRateLimit(db, `report:ip:${ipHash ?? 'unknown'}`, max, win);
    const t = await verifyTurnstile(c.env, p.data.turnstileToken, ip, deps.fetch);
    if (t === 'not_configured') throw new HttpError(503, ERROR_CODES.TURNSTILE_NOT_CONFIGURED, 'Bot protection is not configured.');
    if (t === 'failed') throw new HttpError(403, ERROR_CODES.TURNSTILE_FAILED, 'Bot verification failed.');

    const token = extractShareToken(p.data.link);
    const link = token
      ? await db.select({ id: sharedLinks.id, workspaceId: sharedLinks.workspaceId }).from(sharedLinks).where(eq(sharedLinks.tokenHash, await sha256Hex(token))).get()
      : undefined;
    const id = crypto.randomUUID();
    await db.insert(reports).values({
      id,
      targetKind: link ? 'shared_link' : 'unknown',
      targetId: link?.id ?? null,
      targetWorkspaceId: link?.workspaceId ?? null,
      reason: p.data.reason,
      details: p.data.details || null,
      reporterContact: p.data.contact || null,
      urgent: URGENT_REASONS.includes(p.data.reason) ? 1 : 0,
      reporterIpHash: ipHash,
    });
    // o link nunca é guardado; o denunciante não recebe o id (nada a consultar sem conta)
    return c.json({ received: true }, 201);
  });
  return r;
}

/** Notificações in-app do usuário (avisos de moderação aos donos). */
export function notificationRoutes() {
  const r = new Hono<AppEnv>();
  r.use('*', requireAuth);
  r.get('/', async (c) => {
    const rows = await c
      .get('db')
      .select({ id: notifications.id, kind: notifications.kind, payload: notifications.payloadJson, readAt: notifications.readAt, createdAt: notifications.createdAt, workspaceId: notifications.workspaceId })
      .from(notifications)
      .where(eq(notifications.userId, c.get('user').id))
      .orderBy(desc(notifications.createdAt))
      .limit(30)
      .all();
    return c.json({ notifications: rows.map((n) => ({ ...n, payload: JSON.parse(n.payload) as unknown })) });
  });
  r.post('/:id/read', async (c) => {
    const row = await c
      .get('db')
      .update(notifications)
      .set({ readAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.userId, c.get('user').id), isNull(notifications.readAt)))
      .returning({ id: notifications.id })
      .get();
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    return c.body(null, 204);
  });
  return r;
}

/** Retenção (docs/privacy): denúncias encerradas há mais de N dias são apagadas. */
export async function purgeReports(db: AppEnv['Variables']['db'], now: number) {
  const days = await getIntSetting(db, 'report.retention_days', 180);
  await db.delete(reports).where(and(lt(reports.updatedAt, now - days * 86_400_000), lt(reports.resolvedAt, now)));
}
