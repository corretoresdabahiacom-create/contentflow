import { and, desc, eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  ERROR_CODES,
  EXPORT_SCHEMA,
  EXPORT_SCHEMA_VERSION,
  OUTPUT_KINDS,
  TEXT_MAX_CHARS,
  type ExportDoc,
} from '@contentflow/shared';
import type { AppEnv } from '../context';
import { clients, contentOutputs, projectSources, projects, usageRecords } from '../db/schema';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/http';
import { countOf, quota } from '../lib/quota';
import { getIntSetting } from '../lib/settings';
import { requireRole } from '../middleware';

const name = z.string().trim().min(1).max(80);
const SOURCE_KINDS = ['paste', 'txt', 'md', 'docx', 'pdf', 'csv', 'json'] as const;

const analysisSchema = z.object({
  version: z.number().int(),
  language: z.enum(['pt', 'en', 'es', 'other', 'und']),
  keywords: z.array(z.string().max(120)).max(50),
  summary: z.array(z.string().max(2000)).max(10),
  stats: z.object({ chars: z.number(), words: z.number(), sentences: z.number() }),
  algorithms: z.object({ language: z.string(), keywords: z.string(), summary: z.string() }),
});

const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  filename: z.string().trim().max(200).nullish(),
  text: z.string().min(1).max(TEXT_MAX_CHARS),
  analysis: analysisSchema.nullish(),
});

const outputInput = z.object({
  channel: z.string().trim().min(1).max(40).default('generic'),
  kind: z.enum(OUTPUT_KINDS),
  title: z.string().trim().max(200).nullish(),
  body: z.string().min(1).max(50_000),
});
const outputsBatch = z.object({ outputs: z.array(outputInput).min(1).max(20) });
const outputPatch = z
  .object({
    title: z.string().trim().max(200).nullish(),
    body: z.string().min(1).max(50_000).optional(),
    version: z.number().int().min(1),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined);

async function body<T extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, s: T): Promise<z.infer<T>> {
  const p = s.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
  return p.data;
}

export function registerContentRoutes(r: Hono<AppEnv>) {
  // ---------- clients ----------
  r.post('/:workspaceId/clients', requireRole('admin'), async (c) => {
    const { name: n } = await body(c, z.object({ name }));
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    await quota(
      db,
      'quota.clients_per_workspace',
      10,
      await countOf(db.select({ n: sql<number>`count(*)` }).from(clients).where(eq(clients.workspaceId, workspaceId)).get()),
      'clients per workspace',
    );
    const id = crypto.randomUUID();
    await db.insert(clients).values({ id, workspaceId, name: n });
    await audit(db, { action: 'client.create', userId: c.get('user').id, workspaceId, targetKind: 'client', targetId: id, ipHash: c.get('ipHash') });
    return c.json({ id, name: n, isImplicit: false }, 201);
  });

  r.patch('/:workspaceId/clients/:clientId', requireRole('admin'), async (c) => {
    const { name: n } = await body(c, z.object({ name }));
    const db = c.get('db');
    await db.update(clients).set({ name: n, updatedAt: Date.now() }).where(and(eq(clients.id, c.get('clientId')), eq(clients.workspaceId, c.get('membership').workspaceId)));
    return c.json({ id: c.get('clientId'), name: n });
  });

  r.delete('/:workspaceId/clients/:clientId', requireRole('admin'), async (c) => {
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const row = await db.select().from(clients).where(and(eq(clients.id, c.get('clientId')), eq(clients.workspaceId, workspaceId))).get();
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    if (row.isImplicit === 1) throw new HttpError(400, ERROR_CODES.VALIDATION, 'The default client cannot be deleted.');
    await db.delete(clients).where(eq(clients.id, row.id));
    await audit(db, { action: 'client.delete', userId: c.get('user').id, workspaceId, targetKind: 'client', targetId: row.id, ipHash: c.get('ipHash') });
    return c.body(null, 204);
  });

  // ---------- projects ----------
  r.get('/:workspaceId/clients/:clientId/projects', async (c) => {
    const rows = await c
      .get('db')
      .select({ id: projects.id, name: projects.name, status: projects.status, updatedAt: projects.updatedAt })
      .from(projects)
      .where(and(eq(projects.clientId, c.get('clientId')), eq(projects.workspaceId, c.get('membership').workspaceId)))
      .orderBy(desc(projects.updatedAt))
      .all();
    return c.json({ projects: rows });
  });

  r.post('/:workspaceId/clients/:clientId/projects', async (c) => {
    const { name: n } = await body(c, z.object({ name }));
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    await quota(
      db,
      'quota.projects_per_workspace',
      100,
      await countOf(db.select({ n: sql<number>`count(*)` }).from(projects).where(eq(projects.workspaceId, workspaceId)).get()),
      'projects per workspace',
    );
    const id = crypto.randomUUID();
    await db.insert(projects).values({ id, workspaceId, clientId: c.get('clientId'), name: n, createdBy: c.get('user').id });
    await audit(db, { action: 'project.create', userId: c.get('user').id, workspaceId, targetKind: 'project', targetId: id, ipHash: c.get('ipHash') });
    return c.json({ id, name: n, status: 'active' }, 201);
  });

  const P = '/:workspaceId/clients/:clientId/projects/:projectId';

  r.get(P, async (c) => {
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const p = await db.select().from(projects).where(and(eq(projects.id, c.get('projectId')), eq(projects.workspaceId, workspaceId))).get();
    if (!p) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    const s = await db.select().from(projectSources).where(and(eq(projectSources.projectId, p.id), eq(projectSources.workspaceId, workspaceId))).get();
    return c.json({
      id: p.id,
      clientId: p.clientId,
      name: p.name,
      status: p.status,
      source: s
        ? { kind: s.kind, filename: s.filename, chars: s.chars, text: s.text, analysis: s.analysisJson ? JSON.parse(s.analysisJson) : null, updatedAt: s.updatedAt }
        : null,
    });
  });

  r.patch(P, async (c) => {
    const patch = await body(c, z.object({ name: name.optional(), status: z.enum(['active', 'archived']).optional() }).refine((v) => v.name || v.status));
    const db = c.get('db');
    await db
      .update(projects)
      .set({ ...patch, updatedAt: Date.now() })
      .where(and(eq(projects.id, c.get('projectId')), eq(projects.workspaceId, c.get('membership').workspaceId)));
    return c.json({ id: c.get('projectId'), ...patch });
  });

  r.delete(P, requireRole('admin'), async (c) => {
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    await db.delete(projects).where(and(eq(projects.id, c.get('projectId')), eq(projects.workspaceId, workspaceId)));
    await audit(db, { action: 'project.delete', userId: c.get('user').id, workspaceId, targetKind: 'project', targetId: c.get('projectId'), ipHash: c.get('ipHash') });
    return c.body(null, 204);
  });

  // ---------- source ----------
  r.put(`${P}/source`, async (c) => {
    const s = await body(c, sourceSchema);
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const values = {
      kind: s.kind,
      filename: s.filename ?? null,
      text: s.text,
      chars: s.text.length,
      analysisJson: s.analysis ? JSON.stringify(s.analysis) : null,
      updatedAt: Date.now(),
    };
    await db
      .insert(projectSources)
      .values({ projectId: c.get('projectId'), workspaceId, ...values })
      .onConflictDoUpdate({ target: projectSources.projectId, set: values });
    await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, c.get('projectId')));
    return c.json({ kind: s.kind, chars: values.chars });
  });

  // ---------- outputs ----------
  r.get(`${P}/outputs`, async (c) => {
    const rows = await c
      .get('db')
      .select()
      .from(contentOutputs)
      .where(and(eq(contentOutputs.projectId, c.get('projectId')), eq(contentOutputs.workspaceId, c.get('membership').workspaceId)))
      .orderBy(contentOutputs.createdAt)
      .all();
    return c.json({ outputs: rows });
  });

  r.post(`${P}/outputs`, async (c) => {
    const { outputs } = await body(c, outputsBatch);
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const have = await countOf(db.select({ n: sql<number>`count(*)` }).from(contentOutputs).where(eq(contentOutputs.projectId, c.get('projectId'))).get());
    const limit = await getIntSetting(db, 'quota.outputs_per_project', 200);
    if (have + outputs.length > limit) {
      throw new HttpError(409, ERROR_CODES.QUOTA_EXCEEDED, `Quota reached: outputs per project (limit ${limit}).`, 'quota');
    }
    // R4/R5: tudo gerado na Fase 2 é template; o cliente não escolhe source_kind.
    const created = outputs.map((o) => ({
      id: crypto.randomUUID(),
      workspaceId,
      clientId: c.get('clientId'),
      projectId: c.get('projectId'),
      channel: o.channel,
      kind: o.kind,
      title: o.title ?? null,
      body: o.body,
      sourceKind: 'template' as const,
    }));
    await db.batch(created.map((v) => db.insert(contentOutputs).values(v)) as never);
    return c.json({ outputs: created.map((v) => ({ id: v.id, kind: v.kind, sourceKind: v.sourceKind, version: 1 })) }, 201);
  });

  r.patch(`${P}/outputs/:outputId`, async (c) => {
    const p = await body(c, outputPatch);
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const set: Record<string, unknown> = { version: sql`${contentOutputs.version} + 1`, updatedAt: Date.now() };
    if (p.title !== undefined) set.title = p.title;
    if (p.body !== undefined) set.body = p.body;
    const row = await db
      .update(contentOutputs)
      .set(set)
      .where(
        and(
          eq(contentOutputs.id, c.req.param('outputId') ?? ''),
          eq(contentOutputs.projectId, c.get('projectId')),
          eq(contentOutputs.workspaceId, workspaceId),
          eq(contentOutputs.version, p.version),
        ),
      )
      .returning({ id: contentOutputs.id, version: contentOutputs.version })
      .get();
    if (!row) {
      const exists = await db
        .select({ id: contentOutputs.id })
        .from(contentOutputs)
        .where(and(eq(contentOutputs.id, c.req.param('outputId') ?? ''), eq(contentOutputs.projectId, c.get('projectId')), eq(contentOutputs.workspaceId, workspaceId)))
        .get();
      if (!exists) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'This output was changed elsewhere. Reload and try again.');
    }
    return c.json(row);
  });

  r.delete(`${P}/outputs/:outputId`, async (c) => {
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const row = await db
      .delete(contentOutputs)
      .where(and(eq(contentOutputs.id, c.req.param('outputId') ?? ''), eq(contentOutputs.projectId, c.get('projectId')), eq(contentOutputs.workspaceId, workspaceId)))
      .returning({ id: contentOutputs.id })
      .get();
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    return c.body(null, 204);
  });

  // ---------- export ----------
  // O servidor só monta o documento (sem CPU pesada); a serialização TXT/MD/CSV/JSON é feita no navegador.
  r.get(`${P}/export-data`, async (c) => {
    const db = c.get('db');
    const { workspaceId } = c.get('membership');
    const period = new Date().toISOString().slice(0, 7);
    const used = await countOf(
      db
        .select({ n: sql<number>`coalesce(sum(${usageRecords.amount}), 0)` })
        .from(usageRecords)
        .where(and(eq(usageRecords.workspaceId, workspaceId), eq(usageRecords.metric, 'exports'), eq(usageRecords.period, period)))
        .get(),
    );
    await quota(db, 'quota.exports_per_month', 500, used, 'exports per month');

    const p = await db.select().from(projects).where(and(eq(projects.id, c.get('projectId')), eq(projects.workspaceId, workspaceId))).get();
    const cl = await db.select().from(clients).where(eq(clients.id, c.get('clientId'))).get();
    if (!p || !cl) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    const s = await db.select().from(projectSources).where(eq(projectSources.projectId, p.id)).get();
    const outs = await db.select().from(contentOutputs).where(eq(contentOutputs.projectId, p.id)).orderBy(contentOutputs.createdAt).all();

    await db.insert(usageRecords).values({ workspaceId, metric: 'exports', amount: 1, period });
    await audit(db, { action: 'project.export', userId: c.get('user').id, workspaceId, targetKind: 'project', targetId: p.id, ipHash: c.get('ipHash') });

    const doc: ExportDoc = {
      schema: EXPORT_SCHEMA,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      project: { id: p.id, name: p.name },
      client: { id: cl.id, name: cl.name },
      source: s ? { kind: s.kind, filename: s.filename, chars: s.chars } : null,
      analysis: s?.analysisJson ? JSON.parse(s.analysisJson) : null,
      outputs: outs.map((o) => ({
        id: o.id,
        channel: o.channel,
        kind: o.kind,
        title: o.title,
        body: o.body,
        version: o.version,
        sourceKind: o.sourceKind as ExportDoc['outputs'][number]['sourceKind'],
        updatedAt: o.updatedAt,
      })),
    };
    return c.json(doc);
  });
}
