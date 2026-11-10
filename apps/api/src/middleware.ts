import { and, eq, or, gt } from 'drizzle-orm';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import { ERROR_CODES, ROLE_RANK, type WorkspaceRole } from '@contentflow/shared';
import type { AppEnv } from './context';
import { clients, projects, sessions, users, workspaceMembers } from './db/schema';
import { randomToken, sha256Hex } from './lib/crypto';
import { HttpError } from './lib/http';
import { getIntSetting } from './lib/settings';

export const SESSION_COOKIE = '__Host-cf_session';

export function setSessionCookie(c: Context<AppEnv>, token: string, maxAgeS: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeS,
  });
}
export const clearSessionCookie = (c: Context<AppEnv>) =>
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });

/** CSRF: SameSite=Lax + exigir Origin same-origin (ou allowlist) em métodos não idempotentes. */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  const allowed = new Set([
    new URL(c.req.url).origin,
    ...(c.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  const origin = c.req.header('Origin');
  if (!origin || !allowed.has(origin)) {
    throw new HttpError(403, ERROR_CODES.ORIGIN_NOT_ALLOWED, 'Origin not allowed.');
  }
  return next();
};

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  if (!c.res.headers.has('Referrer-Policy')) c.header('Referrer-Policy', 'strict-origin-when-cross-origin'); // rotas públicas podem pedir no-referrer
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const unauth = () => {
    clearSessionCookie(c);
    return new HttpError(401, ERROR_CODES.UNAUTHENTICATED, 'Authentication required.');
  };
  if (!token) throw new HttpError(401, ERROR_CODES.UNAUTHENTICATED, 'Authentication required.');

  const db = c.get('db');
  const now = Date.now();
  const th = await sha256Hex(token);
  const row = await db
    .select({
      sid: sessions.id,
      tokenHash: sessions.tokenHash,
      expiresAt: sessions.expiresAt,
      rotatedAt: sessions.rotatedAt,
      uid: users.id,
      email: users.email,
      status: users.status,
      isGlobalAdmin: users.isGlobalAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      or(
        eq(sessions.tokenHash, th),
        and(eq(sessions.prevTokenHash, th), gt(sessions.prevValidUntil, now)),
      ),
    )
    .get();
  if (!row || row.expiresAt <= now || row.status !== 'active') throw unauth();

  // Rotação: só quando o token atual é o vigente e já passou o prazo (1 escrita/dia/sessão).
  const rotateAfterS = await getIntSetting(db, 'session.rotate_after_s', 86_400);
  if (row.tokenHash === th && now - row.rotatedAt > rotateAfterS * 1000) {
    const ttlS = await getIntSetting(db, 'session.ttl_s', 2_592_000);
    const next = randomToken(32);
    await db
      .update(sessions)
      .set({
        tokenHash: await sha256Hex(next),
        prevTokenHash: th,
        prevValidUntil: now + 60_000,
        rotatedAt: now,
        expiresAt: now + ttlS * 1000,
        updatedAt: now,
      })
      .where(eq(sessions.id, row.sid));
    setSessionCookie(c, next, ttlS);
  }
  c.set('user', { id: row.uid, email: row.email, isGlobalAdmin: row.isGlobalAdmin === 1 });
  await next();
};

/** user → workspace: não-membro recebe 404 (não revela existência). */
export const workspaceContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const workspaceId = c.req.param('workspaceId') ?? '';
  const m = await c
    .get('db')
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, c.get('user').id),
      ),
    )
    .get();
  if (!m) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
  c.set('membership', { workspaceId, role: m.role as WorkspaceRole });
  await next();
};

/** workspace → client: o client precisa pertencer ao workspace já autorizado. */
export const clientContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const clientId = c.req.param('clientId') ?? '';
  const row = await c
    .get('db')
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.workspaceId, c.get('membership').workspaceId)))
    .get();
  if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
  c.set('clientId', row.id);
  await next();
};

/** client → project: o projeto precisa pertencer ao workspace E ao client da rota. */
export const projectContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const projectId = c.req.param('projectId') ?? '';
  const row = await c
    .get('db')
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.clientId, c.get('clientId')),
        eq(projects.workspaceId, c.get('membership').workspaceId),
      ),
    )
    .get();
  if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
  c.set('projectId', row.id);
  await next();
};

export const requireRole =
  (min: WorkspaceRole): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (ROLE_RANK[c.get('membership').role] < ROLE_RANK[min]) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Insufficient role.');
    }
    await next();
  };
