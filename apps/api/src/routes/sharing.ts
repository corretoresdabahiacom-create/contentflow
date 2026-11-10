import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Hono as HonoT } from 'hono';
import { z } from 'zod';
import { ERROR_CODES } from '@contentflow/shared';
import type { AppEnv } from '../context';
import { brandKits, clients, contentOutputs, projects, sharedLinkAccessLogs, sharedLinkOutputs, sharedLinks } from '../db/schema';
import { audit } from '../lib/audit';
import { randomToken, sha256Hex } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { hitRateLimit } from '../lib/ratelimit';
import { countOf, quota } from '../lib/quota';
import { requireRole } from '../middleware';

const notFound = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
const createBody = z.object({
  outputIds: z.array(z.string().max(64)).min(1).max(50),
  expiresInDays: z.number().int().min(1).max(30).default(30),
});
const LOG_DEDUPE_MS = 10 * 60_000;

/**
 * Link compartilhável: expõe APENAS os outputs escolhidos + o brand kit do client.
 * Nunca o texto-fonte, a transcrição, o áudio, o vídeo, os cortes nem outros outputs.
 */
export function registerSharingRoutes(r: HonoT<AppEnv>) {
  const S = '/:workspaceId/clients/:clientId/shared-links';

  // Lista (sem o corpo) dos outputs do client, para escolher o que compartilhar.
  r.get('/:workspaceId/clients/:clientId/outputs', requireRole('admin'), async (c) => {
    const rows = await c
      .get('db')
      .select({ id: contentOutputs.id, channel: contentOutputs.channel, kind: contentOutputs.kind, title: contentOutputs.title, version: contentOutputs.version, projectName: projects.name })
      .from(contentOutputs)
      .innerJoin(projects, eq(projects.id, contentOutputs.projectId))
      .where(and(eq(contentOutputs.clientId, c.get('clientId')), eq(contentOutputs.workspaceId, c.get('membership').workspaceId)))
      .orderBy(desc(contentOutputs.updatedAt))
      .limit(200)
      .all();
    return c.json({ outputs: rows });
  });

  r.post(S, requireRole('admin'), async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
    const ids = [...new Set(p.data.outputIds)];
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const found = await db.select({ id: contentOutputs.id }).from(contentOutputs).where(and(inArray(contentOutputs.id, ids), eq(contentOutputs.clientId, c.get('clientId')), eq(contentOutputs.workspaceId, workspaceId))).all();
    if (found.length !== ids.length) throw notFound(); // algum output é de outro client/workspace
    const active = await countOf(db.select({ n: sql<number>`count(*)` }).from(sharedLinks).where(and(eq(sharedLinks.workspaceId, workspaceId), isNull(sharedLinks.revokedAt), gt(sharedLinks.expiresAt, Date.now()))).get());
    await quota(db, 'quota.shared_links_per_workspace', 50, active, 'active shared links');
    const token = randomToken(32);
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + p.data.expiresInDays * 86_400_000;
    await db.batch([
      db.insert(sharedLinks).values({ id, workspaceId, clientId: c.get('clientId'), tokenHash: await sha256Hex(token), expiresAt, createdBy: c.get('user').id }),
      db.insert(sharedLinkOutputs).values(ids.map((outputId) => ({ linkId: id, outputId }))),
    ]);
    await audit(db, { action: 'sharedlink.create', userId: c.get('user').id, workspaceId, targetKind: 'shared_link', targetId: id, metadata: { outputs: ids.length, expiresAt } });
    return c.json({ id, expiresAt, outputs: ids.length, token, path: `/s/${token}` }, 201);
  });

  r.get(S, requireRole('admin'), async (c) => {
    const db = c.get('db');
    const links = await db
      .select({ id: sharedLinks.id, createdAt: sharedLinks.createdAt, expiresAt: sharedLinks.expiresAt, revokedAt: sharedLinks.revokedAt })
      .from(sharedLinks)
      .where(and(eq(sharedLinks.clientId, c.get('clientId')), eq(sharedLinks.workspaceId, c.get('membership').workspaceId)))
      .orderBy(desc(sharedLinks.createdAt))
      .limit(100)
      .all();
    const ids = links.map((l) => l.id);
    const outs = ids.length ? await db.select({ linkId: sharedLinkOutputs.linkId, n: sql<number>`count(*)` }).from(sharedLinkOutputs).where(inArray(sharedLinkOutputs.linkId, ids)).groupBy(sharedLinkOutputs.linkId).all() : [];
    const views = ids.length ? await db.select({ linkId: sharedLinkAccessLogs.linkId, n: sql<number>`count(*)`, last: sql<number>`max(${sharedLinkAccessLogs.accessedAt})` }).from(sharedLinkAccessLogs).where(inArray(sharedLinkAccessLogs.linkId, ids)).groupBy(sharedLinkAccessLogs.linkId).all() : [];
    const now = Date.now();
    return c.json({
      links: links.map((l) => ({
        ...l,
        status: l.revokedAt ? 'revoked' : l.expiresAt <= now ? 'expired' : 'active',
        outputs: outs.find((o) => o.linkId === l.id)?.n ?? 0,
        views: views.find((v) => v.linkId === l.id)?.n ?? 0,
        lastViewedAt: views.find((v) => v.linkId === l.id)?.last ?? null,
      })),
    });
  });

  r.delete(`${S}/:linkId`, requireRole('admin'), async (c) => {
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const row = await db
      .update(sharedLinks)
      .set({ revokedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(sharedLinks.id, c.req.param('linkId') ?? ''), eq(sharedLinks.clientId, c.get('clientId')), eq(sharedLinks.workspaceId, workspaceId), isNull(sharedLinks.revokedAt)))
      .returning({ id: sharedLinks.id })
      .get();
    if (!row) throw notFound();
    await audit(db, { action: 'sharedlink.revoke', userId: c.get('user').id, workspaceId, targetKind: 'shared_link', targetId: row.id });
    return c.json({ ok: true });
  });

  r.get(`${S}/:linkId/access-logs`, requireRole('admin'), async (c) => {
    const db = c.get('db');
    const link = await db.select({ id: sharedLinks.id }).from(sharedLinks).where(and(eq(sharedLinks.id, c.req.param('linkId') ?? ''), eq(sharedLinks.clientId, c.get('clientId')), eq(sharedLinks.workspaceId, c.get('membership').workspaceId))).get();
    if (!link) throw notFound();
    const rows = await db.select({ accessedAt: sharedLinkAccessLogs.accessedAt, ipHash: sharedLinkAccessLogs.ipHash, userAgent: sharedLinkAccessLogs.userAgent }).from(sharedLinkAccessLogs).where(eq(sharedLinkAccessLogs.linkId, link.id)).orderBy(desc(sharedLinkAccessLogs.accessedAt)).limit(100).all();
    return c.json({ logs: rows.map((l) => ({ accessedAt: l.accessedAt, visitor: l.ipHash ? l.ipHash.slice(0, 8) : null, userAgent: l.userAgent })) });
  });
}

/** Leitura pública (sem login) por token. Inválido, expirado e revogado têm a mesma resposta 404. */
export function sharedPublicRoutes() {
  const r = new Hono<AppEnv>();
  r.get('/:token', async (c) => {
    const db = c.get('db');
    const ip = c.req.header('CF-Connecting-IP') ?? null;
    const pepper = c.env.SESSION_PEPPER ?? '';
    const visitor = ip ? (await sha256Hex(`${pepper}:${ip}`)).slice(0, 32) : null;
    await hitRateLimit(db, `shared:${visitor ?? 'unknown'}`, 120, 600);
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    c.header('Referrer-Policy', 'no-referrer');

    const link = await db
      .select({ id: sharedLinks.id, clientId: sharedLinks.clientId, expiresAt: sharedLinks.expiresAt })
      .from(sharedLinks)
      .where(and(eq(sharedLinks.tokenHash, await sha256Hex(c.req.param('token') ?? '')), isNull(sharedLinks.revokedAt), gt(sharedLinks.expiresAt, Date.now())))
      .get();
    if (!link) throw notFound();

    // log de acesso com dedupe (mesmo visitante em 10 min = 1 registro): protege o orçamento de escritas do D1
    const recent = await db.select({ id: sharedLinkAccessLogs.id }).from(sharedLinkAccessLogs).where(and(eq(sharedLinkAccessLogs.linkId, link.id), visitor ? eq(sharedLinkAccessLogs.ipHash, visitor) : isNull(sharedLinkAccessLogs.ipHash), gt(sharedLinkAccessLogs.accessedAt, Date.now() - LOG_DEDUPE_MS))).get();
    if (!recent) await db.insert(sharedLinkAccessLogs).values({ linkId: link.id, ipHash: visitor, userAgent: (c.req.header('User-Agent') ?? '').slice(0, 200) || null });

    const client = await db.select({ name: clients.name, isImplicit: clients.isImplicit }).from(clients).where(eq(clients.id, link.clientId)).get();
    const kit = await db.select().from(brandKits).where(eq(brandKits.clientId, link.clientId)).get();
    const outs = await db
      .select({ id: contentOutputs.id, channel: contentOutputs.channel, kind: contentOutputs.kind, title: contentOutputs.title, body: contentOutputs.body, sourceKind: contentOutputs.sourceKind, updatedAt: contentOutputs.updatedAt })
      .from(sharedLinkOutputs)
      .innerJoin(contentOutputs, eq(contentOutputs.id, sharedLinkOutputs.outputId))
      .where(and(eq(sharedLinkOutputs.linkId, link.id), eq(contentOutputs.clientId, link.clientId)))
      .all();
    return c.json({
      clientName: client?.isImplicit ? null : (client?.name ?? null),
      brandKit: kit ? { name: kit.name, logoUrl: kit.logoUrl, primaryColor: kit.primaryColor, tone: kit.tone } : null,
      expiresAt: link.expiresAt,
      outputs: outs,
    });
  });
  return r;
}
