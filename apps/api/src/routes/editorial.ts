import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import { BRAND_LIMITS, CALENDAR_STATUSES, ERROR_CODES, isDayMs, normalizeColor, validateLogoUrl } from '@contentflow/shared';
import type { AppEnv } from '../context';
import { approvals, brandKits, clients, contentOutputs, editorialCalendar, projects, users, workspaceMembers, workspaces } from '../db/schema';
import type { Db } from '../db/client';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/http';
import { countOf, quota } from '../lib/quota';
import { requireRole } from '../middleware';

async function parse<T extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, s: T): Promise<z.infer<T>> {
  const p = s.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
  return p.data;
}
const notFound = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');

// ---------- brand kit ----------
const brandInput = z.object({
  name: z.string().trim().min(1).max(BRAND_LIMITS.name),
  logoUrl: z.string().trim().max(BRAND_LIMITS.logoUrl).nullish(),
  primaryColor: z.string().trim().nullish(),
  tone: z.string().trim().max(BRAND_LIMITS.tone).nullish(),
});

// ---------- calendário ----------
const day = z.number().int().refine(isDayMs, 'invalid day');
const entryInput = z.object({
  title: z.string().trim().min(1).max(120),
  scheduledFor: day.nullish(),
  status: z.enum(CALENDAR_STATUSES).default('idea'),
  assigneeUserId: z.string().max(64).nullish(),
  outputId: z.string().max(64).nullish(),
});
const entryPatch = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    scheduledFor: day.nullable().optional(),
    status: z.enum(CALENDAR_STATUSES).optional(),
    assigneeUserId: z.string().max(64).nullable().optional(),
    outputId: z.string().max(64).nullable().optional(),
    version: z.number().int().min(1),
  })
  .refine((v) => Object.keys(v).length > 1);

async function assertAssignee(db: Db, workspaceId: string, userId: string | null | undefined) {
  if (!userId) return;
  const m = await db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).get();
  if (!m) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Assignee must be a workspace member.');
}
async function assertOutput(db: Db, workspaceId: string, clientId: string, outputId: string | null | undefined) {
  if (!outputId) return;
  const o = await db.select({ id: contentOutputs.id }).from(contentOutputs).where(and(eq(contentOutputs.id, outputId), eq(contentOutputs.workspaceId, workspaceId), eq(contentOutputs.clientId, clientId))).get();
  if (!o) throw notFound(); // output de outro client/workspace: 404
}

// ---------- aprovações ----------
const decision = z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(1000).nullish() });
const request = z.object({ note: z.string().trim().max(1000).nullish() });

export function registerEditorialRoutes(r: Hono<AppEnv>) {
  const C = '/:workspaceId/clients/:clientId';
  const P = `${C}/projects/:projectId`;

  // ----- brand kit (1 por client) -----
  r.get(`${C}/brand-kit`, async (c) => {
    const k = await c.get('db').select().from(brandKits).where(eq(brandKits.clientId, c.get('clientId'))).get();
    return c.json({ brandKit: k ? { name: k.name, logoUrl: k.logoUrl, primaryColor: k.primaryColor, tone: k.tone, updatedAt: k.updatedAt } : null });
  });

  r.put(`${C}/brand-kit`, requireRole('admin'), async (c) => {
    const b = await parse(c, brandInput);
    let logoUrl: string | null = null;
    if (b.logoUrl) {
      const v = validateLogoUrl(b.logoUrl);
      if (!v.ok) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Logo URL must be a public https address.');
      logoUrl = v.url;
    }
    let primaryColor: string | null = null;
    if (b.primaryColor) {
      primaryColor = normalizeColor(b.primaryColor);
      if (!primaryColor) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Color must look like #rrggbb.');
    }
    const db = c.get('db');
    const values = { name: b.name, logoUrl, primaryColor, tone: b.tone || null, updatedAt: Date.now() };
    await db.insert(brandKits).values({ clientId: c.get('clientId'), ...values }).onConflictDoUpdate({ target: brandKits.clientId, set: values });
    await audit(db, { action: 'brandkit.update', userId: c.get('user').id, workspaceId: c.get('membership').workspaceId, targetKind: 'client', targetId: c.get('clientId') });
    return c.json({ brandKit: { name: values.name, logoUrl, primaryColor, tone: values.tone, updatedAt: values.updatedAt } });
  });

  // ----- calendário editorial -----
  r.get(`${C}/calendar`, async (c) => {
    const from = Number(c.req.query('from'));
    const to = Number(c.req.query('to'));
    const ranged = Number.isFinite(from) && Number.isFinite(to) && c.req.query('from') && c.req.query('to');
    const rows = await c
      .get('db')
      .select()
      .from(editorialCalendar)
      .where(
        and(
          eq(editorialCalendar.clientId, c.get('clientId')),
          eq(editorialCalendar.workspaceId, c.get('membership').workspaceId),
          ranged ? or(isNull(editorialCalendar.scheduledFor), and(gte(editorialCalendar.scheduledFor, from), lte(editorialCalendar.scheduledFor, to))) : undefined,
        ),
      )
      .orderBy(editorialCalendar.scheduledFor)
      .limit(500)
      .all();
    return c.json({ entries: rows.map((e) => ({ id: e.id, title: e.title, scheduledFor: e.scheduledFor, status: e.status, assigneeUserId: e.assigneeUserId, outputId: e.outputId, version: e.version })) });
  });

  r.post(`${C}/calendar`, async (c) => {
    const b = await parse(c, entryInput);
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    await assertAssignee(db, workspaceId, b.assigneeUserId);
    await assertOutput(db, workspaceId, c.get('clientId'), b.outputId);
    const have = await countOf(db.select({ n: sql<number>`count(*)` }).from(editorialCalendar).where(eq(editorialCalendar.workspaceId, workspaceId)).get());
    await quota(db, 'quota.calendar_per_workspace', 500, have, 'calendar entries');
    const id = crypto.randomUUID();
    await db.insert(editorialCalendar).values({ id, workspaceId, clientId: c.get('clientId'), title: b.title, scheduledFor: b.scheduledFor ?? null, status: b.status, assigneeUserId: b.assigneeUserId ?? null, outputId: b.outputId ?? null });
    return c.json({ id, version: 1 }, 201);
  });

  r.patch(`${C}/calendar/:entryId`, async (c) => {
    const b = await parse(c, entryPatch);
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    if (b.assigneeUserId !== undefined) await assertAssignee(db, workspaceId, b.assigneeUserId);
    if (b.outputId !== undefined) await assertOutput(db, workspaceId, c.get('clientId'), b.outputId);
    const { version, ...rest } = b;
    const set: Record<string, unknown> = { ...rest, version: sql`${editorialCalendar.version} + 1`, updatedAt: Date.now() };
    const where = and(eq(editorialCalendar.id, c.req.param('entryId') ?? ''), eq(editorialCalendar.clientId, c.get('clientId')), eq(editorialCalendar.workspaceId, workspaceId));
    const row = await db.update(editorialCalendar).set(set).where(and(where, eq(editorialCalendar.version, version))).returning({ id: editorialCalendar.id, version: editorialCalendar.version }).get();
    if (!row) {
      const exists = await db.select({ id: editorialCalendar.id }).from(editorialCalendar).where(where).get();
      if (!exists) throw notFound();
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'This entry was changed elsewhere. Reload and try again.');
    }
    return c.json(row);
  });

  r.delete(`${C}/calendar/:entryId`, async (c) => {
    const row = await c
      .get('db')
      .delete(editorialCalendar)
      .where(and(eq(editorialCalendar.id, c.req.param('entryId') ?? ''), eq(editorialCalendar.clientId, c.get('clientId')), eq(editorialCalendar.workspaceId, c.get('membership').workspaceId)))
      .returning({ id: editorialCalendar.id })
      .get();
    if (!row) throw notFound();
    return c.json({ ok: true });
  });

  // ----- aprovações -----
  // pedido: vale para a versão atual do output; editar o output depois invalida a aprovação (UI compara versões)
  r.post(`${P}/outputs/:outputId/approvals`, async (c) => {
    const b = await parse(c, request);
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const o = await db.select({ id: contentOutputs.id, version: contentOutputs.version }).from(contentOutputs).where(and(eq(contentOutputs.id, c.req.param('outputId') ?? ''), eq(contentOutputs.projectId, c.get('projectId')), eq(contentOutputs.workspaceId, workspaceId))).get();
    if (!o) throw notFound();
    // um pedido pendente de versão antiga não bloqueia um novo: fica encerrado como substituído
    await db.update(approvals).set({ status: 'rejected', note: 'Superseded: the output changed.', decidedAt: Date.now(), updatedAt: Date.now() }).where(and(eq(approvals.outputId, o.id), eq(approvals.status, 'pending'), sql`${approvals.outputVersion} <> ${o.version}`));
    const id = crypto.randomUUID();
    try {
      await db.insert(approvals).values({ id, workspaceId, outputId: o.id, outputVersion: o.version, requestedBy: c.get('user').id, note: b.note || null });
    } catch {
      throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'This output already has a pending approval request.'); // índice único parcial
    }
    await audit(db, { action: 'approval.request', userId: c.get('user').id, workspaceId, targetKind: 'output', targetId: o.id });
    return c.json({ id, status: 'pending', outputVersion: o.version }, 201);
  });

  // último pedido por output do projeto (a UI compara outputVersion com a versão atual do output)
  r.get(`${P}/approvals`, async (c) => {
    const rows = await c
      .get('db')
      .select({ id: approvals.id, outputId: approvals.outputId, status: approvals.status, outputVersion: approvals.outputVersion, note: approvals.note, decidedAt: approvals.decidedAt, createdAt: approvals.createdAt })
      .from(approvals)
      .innerJoin(contentOutputs, eq(contentOutputs.id, approvals.outputId))
      .where(and(eq(contentOutputs.projectId, c.get('projectId')), eq(approvals.workspaceId, c.get('membership').workspaceId)))
      .orderBy(desc(approvals.createdAt))
      .limit(200)
      .all();
    const latest = new Map<string, (typeof rows)[number]>();
    for (const a of rows) if (!latest.has(a.outputId)) latest.set(a.outputId, a);
    return c.json({ approvals: [...latest.values()] });
  });

  // caixa de entrada do workspace (qualquer membro vê; decidir exige admin)
  r.get('/:workspaceId/approvals', async (c) => {
    const status = c.req.query('status') === 'all' ? null : 'pending';
    const rows = await c
      .get('db')
      .select({
        id: approvals.id, status: approvals.status, note: approvals.note, outputVersion: approvals.outputVersion, createdAt: approvals.createdAt,
        outputId: contentOutputs.id, outputTitle: contentOutputs.title, channel: contentOutputs.channel, kind: contentOutputs.kind, currentVersion: contentOutputs.version,
        projectId: projects.id, projectName: projects.name, clientId: clients.id, clientName: clients.name, requestedBy: users.email,
      })
      .from(approvals)
      .innerJoin(contentOutputs, eq(contentOutputs.id, approvals.outputId))
      .innerJoin(projects, eq(projects.id, contentOutputs.projectId))
      .innerJoin(clients, eq(clients.id, contentOutputs.clientId))
      .innerJoin(users, eq(users.id, approvals.requestedBy))
      .where(and(eq(approvals.workspaceId, c.get('membership').workspaceId), status ? eq(approvals.status, status) : undefined))
      .orderBy(desc(approvals.createdAt))
      .limit(100)
      .all();
    return c.json({ approvals: rows.map((a) => ({ ...a, stale: a.currentVersion !== a.outputVersion })) });
  });

  r.post('/:workspaceId/approvals/:approvalId/decision', requireRole('admin'), async (c) => {
    const b = await parse(c, decision);
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const uid = c.get('user').id;
    const a = await db.select().from(approvals).where(and(eq(approvals.id, c.req.param('approvalId') ?? ''), eq(approvals.workspaceId, workspaceId))).get();
    if (!a) throw notFound();
    if (a.status !== 'pending') throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'This request was already decided.');
    const o = await db.select({ version: contentOutputs.version }).from(contentOutputs).where(eq(contentOutputs.id, a.outputId)).get();
    if (!o || o.version !== a.outputVersion) throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The output changed after this request. Ask for a new approval.');
    // separação de papéis: em equipe, quem pediu não aprova o próprio pedido (exceto se for o único owner/admin);
    // no workspace pessoal, a "segunda etapa" é do próprio usuário.
    if (a.requestedBy === uid) {
      const ws = await db.select({ kind: workspaces.kind }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
      if (ws?.kind === 'agency') {
        const deciders = await countOf(db.select({ n: sql<number>`count(*)` }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.role, ['owner', 'admin']))).get());
        if (deciders > 1) throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Another owner or admin must decide your own request.');
      }
    }
    const row = await db
      .update(approvals)
      .set({ status: b.status, decidedBy: uid, note: b.note ?? a.note, decidedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(approvals.id, a.id), eq(approvals.status, 'pending')))
      .returning({ id: approvals.id })
      .get();
    if (!row) throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'This request was already decided.');
    await audit(db, { action: `approval.${b.status}`, userId: uid, workspaceId, targetKind: 'output', targetId: a.outputId });
    return c.json({ id: a.id, status: b.status });
  });
}
