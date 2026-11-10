import { and, eq, or } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { ERROR_CODES, loginSchema, registerSchema, type MeResponse } from '@contentflow/shared';
import type { AppEnv, Deps } from '../context';
import type { Db } from '../db/client';
import { clients, sessions, userProfiles, users, workspaceMembers, workspaces } from '../db/schema';
import { audit } from '../lib/audit';
import { randomToken, sha256Hex, timingSafeEqual } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { hashAuthKey, newSalt } from '../lib/password';
import { hitRateLimit } from '../lib/ratelimit';
import { getIntSetting } from '../lib/settings';
import { verifyTurnstile } from '../lib/turnstile';
import { SESSION_COOKIE, clearSessionCookie, requireAuth, setSessionCookie } from '../middleware';

const pepperOf = (c: Context<AppEnv>): string => {
  const p = c.env.SESSION_PEPPER;
  if (!p || p.length < 32) {
    throw new HttpError(503, 'server_not_configured', 'Authentication is not configured.');
  }
  return p;
};

const invalid = () =>
  new HttpError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.');

async function readBody<T>(
  c: Context<AppEnv>,
  parse: (v: unknown) => { success: true; data: T } | { success: false },
): Promise<T> {
  const raw = await c.req.json().catch(() => null);
  const r = parse(raw);
  if (!r.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
  return r.data;
}

async function createSession(c: Context<AppEnv>, db: Db, userId: string) {
  const ttlS = await getIntSetting(db, 'session.ttl_s', 2_592_000);
  const token = randomToken(32);
  await db.insert(sessions).values({
    userId,
    tokenHash: await sha256Hex(token),
    expiresAt: Date.now() + ttlS * 1000,
    userAgent: (c.req.header('User-Agent') ?? '').slice(0, 200) || null,
  });
  setSessionCookie(c, token, ttlS);
}

export function authRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.use('*', async (c, next) => {
    const pepper = pepperOf(c);
    const ip = c.req.header('CF-Connecting-IP') ?? null;
    c.set('ipHash', ip ? (await sha256Hex(`${pepper}:${ip}`)).slice(0, 32) : null);
    await next();
  });

  async function guard(
    c: Context<AppEnv>,
    kind: 'login' | 'register',
    token: string,
    extra?: string,
  ) {
    const db = c.get('db');
    const ipKey = c.get('ipHash') ?? 'unknown';
    const max = await getIntSetting(db, `rate_limit.${kind}.max`, kind === 'login' ? 10 : 5);
    const win = await getIntSetting(
      db,
      `rate_limit.${kind}.window_s`,
      kind === 'login' ? 600 : 3600,
    );
    await hitRateLimit(db, `${kind}:ip:${ipKey}`, max, win);
    if (extra) await hitRateLimit(db, `${kind}:id:${extra}`, max, win);
    const t = await verifyTurnstile(
      c.env,
      token,
      c.req.header('CF-Connecting-IP') ?? null,
      deps.fetch,
    );
    if (t === 'not_configured') {
      throw new HttpError(
        503,
        ERROR_CODES.TURNSTILE_NOT_CONFIGURED,
        'Bot protection is not configured.',
      );
    }
    if (t === 'failed') {
      throw new HttpError(403, ERROR_CODES.TURNSTILE_FAILED, 'Bot verification failed.');
    }
  }

  r.post('/register', async (c) => {
    const pepper = pepperOf(c);
    const db = c.get('db');
    const body = await readBody(c, (v) => registerSchema.safeParse(v));
    await guard(c, 'register', body.turnstileToken);

    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .get();
    if (taken) throw new HttpError(409, ERROR_CODES.EMAIL_TAKEN, 'Email already registered.');

    const salt = newSalt();
    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const displayName = body.displayName ?? body.email.split('@')[0] ?? 'workspace';
    try {
      await db.batch([
        db.insert(users).values({
          id: userId,
          email: body.email,
          passwordSalt: salt,
          passwordHash: await hashAuthKey(pepper, salt, body.authKey),
        }),
        db.insert(userProfiles).values({
          userId,
          displayName: body.displayName ?? null,
          locale: body.locale,
        }),
        db.insert(workspaces).values({
          id: workspaceId,
          name: displayName,
          kind: 'personal',
          ownerUserId: userId,
        }),
        db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' }),
        db.insert(clients).values({
          workspaceId,
          name: body.locale === 'pt' ? 'Eu' : 'Me',
          isImplicit: 1,
        }),
      ]);
    } catch {
      throw new HttpError(409, ERROR_CODES.EMAIL_TAKEN, 'Email already registered.');
    }
    await createSession(c, db, userId);
    await audit(db, { action: 'auth.register', userId, workspaceId, ipHash: c.get('ipHash') });
    return c.json({ user: { id: userId, email: body.email } }, 201);
  });

  r.post('/login', async (c) => {
    const pepper = pepperOf(c);
    const db = c.get('db');
    const body = await readBody(c, (v) => loginSchema.safeParse(v));
    await guard(c, 'login', body.turnstileToken, (await sha256Hex(body.email)).slice(0, 32));

    const user = await db.select().from(users).where(eq(users.email, body.email)).get();
    // Trabalho equivalente quando o usuário não existe (reduz diferença de tempo).
    const expected = await hashAuthKey(pepper, user?.passwordSalt ?? 'x'.repeat(22), body.authKey);
    const ok = !!user && user.status === 'active' && timingSafeEqual(expected, user.passwordHash);
    if (!ok) {
      await audit(db, {
        action: 'auth.login_failed',
        userId: user?.id ?? null,
        ipHash: c.get('ipHash'),
      });
      throw invalid();
    }
    await createSession(c, db, user.id);
    await audit(db, { action: 'auth.login', userId: user.id, ipHash: c.get('ipHash') });
    return c.json({ user: { id: user.id, email: user.email } });
  });

  r.post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const db = c.get('db');
      const th = await sha256Hex(token);
      const s = await db
        .select({ id: sessions.id, userId: sessions.userId })
        .from(sessions)
        .where(or(eq(sessions.tokenHash, th), and(eq(sessions.prevTokenHash, th))))
        .get();
      if (s) {
        await db.delete(sessions).where(eq(sessions.id, s.id));
        await audit(db, { action: 'auth.logout', userId: s.userId, ipHash: c.get('ipHash') });
      }
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  r.get('/me', requireAuth, async (c) => {
    const db = c.get('db');
    const u = c.get('user');
    const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, u.id)).get();
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        kind: workspaces.kind,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, u.id))
      .all();
    const body: MeResponse = {
      user: {
        id: u.id,
        email: u.email,
        displayName: profile?.displayName ?? null,
        locale: profile?.locale ?? 'en',
        isGlobalAdmin: u.isGlobalAdmin,
      },
      workspaces: rows.map((w) => ({ ...w, kind: w.kind as 'personal' | 'agency' })),
    };
    return c.json(body);
  });

  return r;
}
