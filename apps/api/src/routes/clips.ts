import { and, eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import { ERROR_CODES, TRANSCRIPT_LIMITS } from '@contentflow/shared';
import type { AppEnv } from '../context';
import { clipSuggestions, transcripts } from '../db/schema';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/http';
import { countOf, quota } from '../lib/quota';

const ms = z.number().int().min(0).max(TRANSCRIPT_LIMITS.maxDurationMs);
const range = (v: { startMs: number; endMs: number }) => v.endMs > v.startMs;

const clipInput = z
  .object({
    startMs: ms,
    endMs: ms,
    title: z.string().trim().min(1).max(120),
    justification: z.string().trim().min(1).max(1000),
    excerpt: z.string().max(500).default(''),
    notes: z.string().max(2000).nullish(),
    origin: z.enum(['heuristic', 'manual']).default('heuristic'),
    transcriptId: z.string().max(64).nullish(),
    signals: z.record(z.string(), z.unknown()).nullish(),
  })
  .refine(range);
const batch = z.object({ clips: z.array(clipInput).min(1).max(20), replaceHeuristic: z.boolean().default(false) });
const patch = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    notes: z.string().max(2000).nullish(),
    startMs: ms.optional(),
    endMs: ms.optional(),
    version: z.number().int().min(1),
  })
  .refine((v) => (v.startMs === undefined) === (v.endMs === undefined), 'start and end change together')
  .refine((v) => v.startMs === undefined || v.endMs === undefined || v.endMs > v.startMs)
  .refine((v) => v.title !== undefined || v.notes !== undefined || v.startMs !== undefined);

async function parse<T extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, s: T): Promise<z.infer<T>> {
  const p = s.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
  return p.data;
}

export function registerClipRoutes(r: Hono<AppEnv>) {
  const K = '/:workspaceId/clients/:clientId/projects/:projectId/clips';

  r.get(K, async (c) => {
    const rows = await c.get('db').select().from(clipSuggestions).where(eq(clipSuggestions.projectId, c.get('projectId'))).orderBy(clipSuggestions.startMs).all();
    return c.json({
      clips: rows.map((k) => ({
        id: k.id, startMs: k.startMs, endMs: k.endMs, title: k.title, justification: k.justification, excerpt: k.excerpt,
        notes: k.notes, edited: k.edited === 1, version: k.version, origin: k.origin, transcriptId: k.transcriptId,
        signals: k.signalsJson ? JSON.parse(k.signalsJson) : null,
      })),
    });
  });

  r.post(K, async (c) => {
    const { clips, replaceHeuristic } = await parse(c, batch);
    const db = c.get('db');
    const pid = c.get('projectId');
    const { workspaceId } = c.get('membership');

    // transcriptId só pode apontar para transcrição deste projeto (e deste tenant)
    for (const tid of new Set(clips.map((k) => k.transcriptId).filter((x): x is string => !!x))) {
      const t = await db.select({ id: transcripts.id }).from(transcripts).where(and(eq(transcripts.id, tid), eq(transcripts.projectId, pid), eq(transcripts.workspaceId, workspaceId))).get();
      if (!t) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    }
    // substitui só sugestões automáticas ainda não editadas; o trabalho manual nunca é apagado
    const removable = replaceHeuristic
      ? await countOf(db.select({ n: sql<number>`count(*)` }).from(clipSuggestions).where(and(eq(clipSuggestions.projectId, pid), eq(clipSuggestions.origin, 'heuristic'), eq(clipSuggestions.edited, 0))).get())
      : 0;
    const have = await countOf(db.select({ n: sql<number>`count(*)` }).from(clipSuggestions).where(eq(clipSuggestions.projectId, pid)).get());
    await quota(db, 'quota.clips_per_project', 100, have - removable + clips.length - 1, 'clips per project');

    const created = clips.map((k) => ({
      id: crypto.randomUUID(), projectId: pid, transcriptId: k.transcriptId ?? null, startMs: k.startMs, endMs: k.endMs,
      title: k.title, justification: k.justification, excerpt: k.excerpt, notes: k.notes ?? null, origin: k.origin,
      signalsJson: k.signals ? JSON.stringify(k.signals) : null,
    }));
    const stmts = [
      ...(replaceHeuristic ? [db.delete(clipSuggestions).where(and(eq(clipSuggestions.projectId, pid), eq(clipSuggestions.origin, 'heuristic'), eq(clipSuggestions.edited, 0)))] : []),
      ...created.map((v) => db.insert(clipSuggestions).values(v)),
    ];
    await db.batch(stmts as never);
    return c.json({ ids: created.map((k) => k.id) }, 201);
  });

  r.patch(`${K}/:clipId`, async (c) => {
    const p = await parse(c, patch);
    const db = c.get('db');
    const set: Record<string, unknown> = { edited: 1, version: sql`${clipSuggestions.version} + 1`, updatedAt: Date.now() };
    if (p.title !== undefined) set.title = p.title;
    if (p.notes !== undefined) set.notes = p.notes;
    if (p.startMs !== undefined) { set.startMs = p.startMs; set.endMs = p.endMs; }
    const id = c.req.param('clipId') ?? '';
    const row = await db
      .update(clipSuggestions)
      .set(set)
      .where(and(eq(clipSuggestions.id, id), eq(clipSuggestions.projectId, c.get('projectId')), eq(clipSuggestions.version, p.version)))
      .returning({ id: clipSuggestions.id, version: clipSuggestions.version })
      .get();
    if (!row) {
      const exists = await db.select({ id: clipSuggestions.id }).from(clipSuggestions).where(and(eq(clipSuggestions.id, id), eq(clipSuggestions.projectId, c.get('projectId')))).get();
      if (!exists) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'This clip was changed elsewhere. Reload and try again.');
    }
    return c.json(row);
  });

  r.delete(`${K}/:clipId`, async (c) => {
    const db = c.get('db');
    const row = await db.delete(clipSuggestions).where(and(eq(clipSuggestions.id, c.req.param('clipId') ?? ''), eq(clipSuggestions.projectId, c.get('projectId')))).returning({ id: clipSuggestions.id }).get();
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    await audit(db, { action: 'clip.delete', userId: c.get('user').id, workspaceId: c.get('membership').workspaceId, targetKind: 'clip', targetId: row.id, ipHash: c.get('ipHash') });
    return c.body(null, 204);
  });
}
