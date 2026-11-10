import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Hono as HonoT } from 'hono';
import { z } from 'zod';
import { ERROR_CODES } from '@contentflow/shared';
import type { AppEnv } from '../context';
import { editorialCalendar, userProfiles, users, workspaceInvites, workspaceMembers, workspaces } from '../db/schema';
import { audit } from '../lib/audit';
import { randomToken, sha256Hex } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { hitRateLimit } from '../lib/ratelimit';
import { countOf, quota } from '../lib/quota';
import { requireAuth, requireRole } from '../middleware';

async function parse<T extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, s: T): Promise<z.infer<T>> {
  const p = s.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
  return p.data;
}
const notFound = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');

const createWs = z.object({ name: z.string().trim().min(1).max(80) });
const roleBody = z.object({ role: z.enum(['admin', 'member']) });
const inviteBody = z.object({ role: z.enum(['admin', 'member']).default('member'), expiresInDays: z.number().int().min(1).max(30).default(7) });

/** Rotas de equipe dentro de /api/workspaces (já atrás de requireAuth + workspaceContext). */
export function registerTeamRoutes(r: HonoT<AppEnv>) {
  // Cria um workspace de equipe (agency). O workspace pessoal nasce no cadastro e nunca tem outros membros.
  r.post('/', async (c) => {
    const { name } = await parse(c, createWs);
    const db = c.get('db');
    const uid = c.get('user').id;
    const have = await countOf(db.select({ n: sql<number>`count(*)` }).from(workspaces).where(and(eq(workspaces.ownerUserId, uid), eq(workspaces.kind, 'agency'))).get());
    await quota(db, 'quota.workspaces_per_user', 3, have, 'team workspaces');
    const id = crypto.randomUUID();
    await db.batch([
      db.insert(workspaces).values({ id, name, kind: 'agency', ownerUserId: uid }),
      db.insert(workspaceMembers).values({ workspaceId: id, userId: uid, role: 'owner' }),
    ]);
    await audit(db, { action: 'workspace.create', userId: uid, workspaceId: id, targetKind: 'workspace', targetId: id });
    return c.json({ id, name, kind: 'agency', role: 'owner' }, 201);
  });

  r.get('/:workspaceId/members', async (c) => {
    const { workspaceId } = c.get('membership');
    const rows = await c
      .get('db')
      .select({ id: workspaceMembers.id, userId: workspaceMembers.userId, role: workspaceMembers.role, email: users.email, displayName: userProfiles.displayName })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .all();
    const me = c.get('user').id;
    return c.json({ members: rows.map((m) => ({ ...m, isYou: m.userId === me })) });
  });

  r.patch('/:workspaceId/members/:memberId', requireRole('owner'), async (c) => {
    const { role } = await parse(c, roleBody);
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const m = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.id, c.req.param('memberId') ?? ''), eq(workspaceMembers.workspaceId, workspaceId))).get();
    if (!m) throw notFound();
    if (m.role === 'owner') throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'The owner role cannot be changed.');
    await db.update(workspaceMembers).set({ role, updatedAt: Date.now() }).where(eq(workspaceMembers.id, m.id));
    await audit(db, { action: 'member.role', userId: c.get('user').id, workspaceId, targetKind: 'member', targetId: m.id, metadata: { role } });
    return c.json({ id: m.id, role });
  });

  r.delete('/:workspaceId/members/:memberId', async (c) => {
    const db = c.get('db');
    const { workspaceId, role: myRole } = c.get('membership');
    const m = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.id, c.req.param('memberId') ?? ''), eq(workspaceMembers.workspaceId, workspaceId))).get();
    if (!m) throw notFound();
    const self = m.userId === c.get('user').id;
    if (m.role === 'owner') throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'The owner cannot be removed.');
    // sair é sempre permitido; remover outro exige admin (e só o owner remove um admin)
    if (!self && (myRole === 'member' || (m.role === 'admin' && myRole !== 'owner'))) throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Insufficient role.');
    await db.batch([
      db.delete(workspaceMembers).where(eq(workspaceMembers.id, m.id)),
      db.update(editorialCalendar).set({ assigneeUserId: null, updatedAt: Date.now() }).where(and(eq(editorialCalendar.workspaceId, workspaceId), eq(editorialCalendar.assigneeUserId, m.userId))),
    ]);
    await audit(db, { action: self ? 'member.leave' : 'member.remove', userId: c.get('user').id, workspaceId, targetKind: 'member', targetId: m.id });
    return c.json({ ok: true });
  });

  // ---------- convites por link (sem e-mail transacional) ----------
  r.get('/:workspaceId/invites', requireRole('admin'), async (c) => {
    const rows = await c
      .get('db')
      .select({ id: workspaceInvites.id, role: workspaceInvites.role, expiresAt: workspaceInvites.expiresAt, createdAt: workspaceInvites.createdAt })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.workspaceId, c.get('membership').workspaceId), isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt), gt(workspaceInvites.expiresAt, Date.now())))
      .all();
    return c.json({ invites: rows });
  });

  r.post('/:workspaceId/invites', requireRole('admin'), async (c) => {
    const b = await parse(c, inviteBody);
    const db = c.get('db');
    const { workspaceId, role: myRole } = c.get('membership');
    const ws = await db.select({ kind: workspaces.kind }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    if (ws?.kind !== 'agency') throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'Invites are only available in team workspaces.');
    if (b.role === 'admin' && myRole !== 'owner') throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only the owner can invite admins.');
    const members = await countOf(db.select({ n: sql<number>`count(*)` }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId)).get());
    const pending = await countOf(db.select({ n: sql<number>`count(*)` }).from(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, workspaceId), isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt), gt(workspaceInvites.expiresAt, Date.now()))).get());
    await quota(db, 'quota.members_per_workspace', 10, members + pending, 'members and pending invites');
    const token = randomToken(32);
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + b.expiresInDays * 86_400_000;
    await db.insert(workspaceInvites).values({ id, workspaceId, tokenHash: await sha256Hex(token), role: b.role, expiresAt, createdBy: c.get('user').id });
    await audit(db, { action: 'invite.create', userId: c.get('user').id, workspaceId, targetKind: 'invite', targetId: id, metadata: { role: b.role } });
    // o token só aparece nesta resposta; só o hash fica guardado
    return c.json({ id, role: b.role, expiresAt, token, path: `/invite/${token}` }, 201);
  });

  r.delete('/:workspaceId/invites/:inviteId', requireRole('admin'), async (c) => {
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const row = await db
      .update(workspaceInvites)
      .set({ revokedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(workspaceInvites.id, c.req.param('inviteId') ?? ''), eq(workspaceInvites.workspaceId, workspaceId), isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt)))
      .returning({ id: workspaceInvites.id })
      .get();
    if (!row) throw notFound();
    await audit(db, { action: 'invite.revoke', userId: c.get('user').id, workspaceId, targetKind: 'invite', targetId: row.id });
    return c.json({ ok: true });
  });
}

/** /api/invites: quem tem o link (e está logado) vê o convite e aceita. Um convite vale uma vez. */
export function inviteRoutes() {
  const r = new Hono<AppEnv>();
  r.use('*', requireAuth);

  const lookup = async (c: Parameters<typeof requireAuth>[0], token: string) => {
    const db = c.get('db');
    const inv = await db
      .select({ id: workspaceInvites.id, workspaceId: workspaceInvites.workspaceId, role: workspaceInvites.role, expiresAt: workspaceInvites.expiresAt, workspaceName: workspaces.name })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
      .where(and(eq(workspaceInvites.tokenHash, await sha256Hex(token)), isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt), gt(workspaceInvites.expiresAt, Date.now())))
      .get();
    if (!inv) throw notFound(); // inválido, expirado, revogado ou já usado: mesma resposta
    return inv;
  };

  r.get('/:token', async (c) => {
    await hitRateLimit(c.get('db'), `invite:${c.get('user').id}`, 30, 600);
    const inv = await lookup(c, c.req.param('token') ?? '');
    const mine = await c.get('db').select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, inv.workspaceId), eq(workspaceMembers.userId, c.get('user').id))).get();
    return c.json({ workspaceName: inv.workspaceName, role: inv.role, expiresAt: inv.expiresAt, alreadyMember: !!mine });
  });

  r.post('/:token/accept', async (c) => {
    const db = c.get('db');
    const uid = c.get('user').id;
    await hitRateLimit(db, `invite:${uid}`, 30, 600);
    const inv = await lookup(c, c.req.param('token') ?? '');
    const mine = await db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, inv.workspaceId), eq(workspaceMembers.userId, uid))).get();
    if (mine) throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'You are already a member of this workspace.');
    const members = await countOf(db.select({ n: sql<number>`count(*)` }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, inv.workspaceId)).get());
    await quota(db, 'quota.members_per_workspace', 10, members, 'members');
    // reivindica o convite de forma atômica: só um aceite vence
    const claimed = await db
      .update(workspaceInvites)
      .set({ acceptedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(workspaceInvites.id, inv.id), isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt), gt(workspaceInvites.expiresAt, Date.now())))
      .returning({ id: workspaceInvites.id })
      .get();
    if (!claimed) throw notFound();
    try {
      await db.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId: uid, role: inv.role });
    } catch {
      await db.update(workspaceInvites).set({ acceptedAt: null, updatedAt: Date.now() }).where(eq(workspaceInvites.id, inv.id)); // devolve o convite
      throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'You are already a member of this workspace.');
    }
    await audit(db, { action: 'invite.accept', userId: uid, workspaceId: inv.workspaceId, targetKind: 'invite', targetId: inv.id, metadata: { role: inv.role } });
    return c.json({ workspaceId: inv.workspaceId, role: inv.role });
  });
  return r;
}
