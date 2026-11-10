import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  ERROR_CODES,
  TRANSCRIPT_LIMITS,
  segmentsToText,
  validateSegments,
  type Segment,
} from '@contentflow/shared';
import type { AppEnv } from '../context';
import type { Db } from '../db/client';
import { processingJobs, transcriptSegments, transcripts, usageRecords } from '../db/schema';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/http';
import { countOf, quota } from '../lib/quota';

/**
 * Máquina de estados do job de transcrição (persistida em processing_jobs.status):
 *
 *   colada / SRT / VTT:  submitted → validating → waiting_review → completed
 *   WASM (navegador):    running → (submit) validating → waiting_review → completed
 *   qualquer estado não terminal → canceled; running → failed (erro informado pelo navegador)
 *
 * O Worker nunca transcreve nada: só valida, guarda o rascunho e, na aprovação, grava a transcrição.
 */
const ACTIVE = ['submitted', 'validating', 'waiting_review', 'running'] as const;
const FAIL_CODES = ['wasm_unsupported', 'wasm_download_failed', 'wasm_out_of_memory', 'wasm_failed', 'user_aborted'] as const;

const segmentSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string().max(TRANSCRIPT_LIMITS.maxSegmentChars),
});
const languageSchema = z.enum(['pt', 'en', 'es', 'other', 'und']).nullish();
const content = z
  .object({
    text: z.string().trim().min(1).max(TRANSCRIPT_LIMITS.maxChars).optional(),
    segments: z.array(segmentSchema).min(1).max(TRANSCRIPT_LIMITS.maxSegments).optional(),
    language: languageSchema,
  })
  .refine((v) => v.text || v.segments);
const createSchema = z.discriminatedUnion('origin', [
  z.object({ origin: z.literal('pasted'), text: z.string().trim().min(1).max(TRANSCRIPT_LIMITS.maxChars), language: languageSchema }),
  z.object({ origin: z.literal('srt'), segments: z.array(segmentSchema).min(1).max(TRANSCRIPT_LIMITS.maxSegments), language: languageSchema }),
  z.object({ origin: z.literal('vtt'), segments: z.array(segmentSchema).min(1).max(TRANSCRIPT_LIMITS.maxSegments), language: languageSchema }),
  z.object({ origin: z.literal('wasm') }),
]);

type Draft = { text: string; segments: Segment[]; language: string | null };

async function parse<T extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, s: T): Promise<z.infer<T>> {
  const p = s.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
  return p.data;
}

/** validating: confere segmentos e deriva o texto no servidor (não confia no texto do cliente). */
function toDraft(v: { text?: string; segments?: Segment[]; language?: string | null }): Draft {
  const segments = v.segments ?? [];
  if (segments.length && !validateSegments(segments)) {
    throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid segments (timing, order or size).');
  }
  const text = segments.length ? segmentsToText(segments) : (v.text ?? '');
  if (!text.trim() || text.length > TRANSCRIPT_LIMITS.maxChars) {
    throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid transcript text.');
  }
  return { text, segments, language: v.language ?? null };
}

/** Transição atômica: só avança se o estado atual for o esperado (evita corrida entre abas). */
async function move(
  db: Db,
  id: string,
  workspaceId: string,
  projectId: string,
  from: readonly string[],
  to: string,
  extra: Partial<typeof processingJobs.$inferInsert> = {},
) {
  const row = await db
    .update(processingJobs)
    .set({ status: to, updatedAt: Date.now(), ...extra })
    .where(
      and(
        eq(processingJobs.id, id),
        eq(processingJobs.workspaceId, workspaceId),
        eq(processingJobs.projectId, projectId),
        eq(processingJobs.kind, 'transcript'),
        inArray(processingJobs.status, [...from]),
      ),
    )
    .returning({ id: processingJobs.id })
    .get();
  if (!row) {
    const exists = await db
      .select({ status: processingJobs.status })
      .from(processingJobs)
      .where(and(eq(processingJobs.id, id), eq(processingJobs.workspaceId, workspaceId), eq(processingJobs.projectId, projectId), eq(processingJobs.kind, 'transcript')))
      .get();
    if (!exists) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    throw new HttpError(409, ERROR_CODES.INVALID_STATE, `Job is ${exists.status}; this action is not allowed now.`);
  }
}

async function loadJob(db: Db, id: string, workspaceId: string, projectId: string) {
  const job = await db
    .select()
    .from(processingJobs)
    .where(and(eq(processingJobs.id, id), eq(processingJobs.workspaceId, workspaceId), eq(processingJobs.projectId, projectId), eq(processingJobs.kind, 'transcript')))
    .get();
  if (!job) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
  return job;
}

const publicJob = (j: typeof processingJobs.$inferSelect) => ({
  id: j.id,
  origin: j.origin,
  status: j.status,
  errorCode: j.errorCode,
  transcriptId: j.transcriptId,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
});

export function registerTranscriptRoutes(r: Hono<AppEnv>) {
  const P = '/:workspaceId/clients/:clientId/projects/:projectId';
  const J = `${P}/transcript-jobs`;
  const ids = (c: { get(k: 'membership'): { workspaceId: string }; get(k: 'projectId'): string }) => ({
    ws: c.get('membership').workspaceId,
    pid: c.get('projectId'),
  });

  r.get(J, async (c) => {
    const { ws, pid } = ids(c as never);
    const rows = await c
      .get('db')
      .select()
      .from(processingJobs)
      .where(and(eq(processingJobs.projectId, pid), eq(processingJobs.workspaceId, ws), eq(processingJobs.kind, 'transcript')))
      .orderBy(desc(processingJobs.createdAt))
      .limit(30)
      .all();
    return c.json({ jobs: rows.map(publicJob) });
  });

  r.post(J, async (c) => {
    const input = await parse(c, createSchema);
    const db = c.get('db');
    const { ws, pid } = ids(c as never);
    const active = await countOf(
      db
        .select({ n: sql<number>`count(*)` })
        .from(processingJobs)
        .where(and(eq(processingJobs.projectId, pid), eq(processingJobs.kind, 'transcript'), inArray(processingJobs.status, [...ACTIVE])))
        .get(),
    );
    await quota(db, 'quota.active_jobs_per_project', 5, active, 'open transcription jobs per project');

    const id = crypto.randomUUID();
    const base = { id, workspaceId: ws, projectId: pid, kind: 'transcript', origin: input.origin };
    if (input.origin === 'wasm') {
      await db.insert(processingJobs).values({ ...base, status: 'running' });
      return c.json({ id, status: 'running' }, 201);
    }
    const draft = toDraft(input); // lança 400 antes de gravar qualquer coisa
    await db.insert(processingJobs).values({ ...base, status: 'submitted' });
    await move(db, id, ws, pid, ['submitted'], 'validating');
    await move(db, id, ws, pid, ['validating'], 'waiting_review', { payloadJson: JSON.stringify(draft) });
    return c.json({ id, status: 'waiting_review' }, 201);
  });

  r.get(`${J}/:jobId`, async (c) => {
    const { ws, pid } = ids(c as never);
    const job = await loadJob(c.get('db'), c.req.param('jobId') ?? '', ws, pid);
    return c.json({ ...publicJob(job), draft: job.payloadJson ? (JSON.parse(job.payloadJson) as Draft) : null });
  });

  // WASM: o navegador terminou e envia o resultado (running → validating → waiting_review).
  r.post(`${J}/:jobId/submit`, async (c) => {
    const input = await parse(c, content);
    const db = c.get('db');
    const { ws, pid } = ids(c as never);
    const jobId = c.req.param('jobId') ?? '';
    const job = await loadJob(db, jobId, ws, pid);
    if (job.origin !== 'wasm') throw new HttpError(409, ERROR_CODES.INVALID_STATE, 'Only browser (WASM) jobs accept a submit.');
    await move(db, jobId, ws, pid, ['running'], 'validating');
    try {
      const draft = toDraft(input);
      await move(db, jobId, ws, pid, ['validating'], 'waiting_review', { payloadJson: JSON.stringify(draft) });
    } catch (e) {
      await move(db, jobId, ws, pid, ['validating'], 'failed', { errorCode: 'invalid_result', payloadJson: null });
      throw e;
    }
    return c.json({ id: jobId, status: 'waiting_review' });
  });

  r.post(`${J}/:jobId/fail`, async (c) => {
    const { code } = await parse(c, z.object({ code: z.enum(FAIL_CODES) }));
    const { ws, pid } = ids(c as never);
    const jobId = c.req.param('jobId') ?? '';
    await move(c.get('db'), jobId, ws, pid, ['running'], 'failed', { errorCode: code, payloadJson: null });
    return c.json({ id: jobId, status: 'failed' });
  });

  r.post(`${J}/:jobId/cancel`, async (c) => {
    const { ws, pid } = ids(c as never);
    const jobId = c.req.param('jobId') ?? '';
    await move(c.get('db'), jobId, ws, pid, ACTIVE, 'canceled', { payloadJson: null });
    return c.json({ id: jobId, status: 'canceled' });
  });

  // Revisão humana concluída → grava a transcrição (waiting_review → completed). Conta na quota mensal.
  r.post(`${J}/:jobId/approve`, async (c) => {
    const edit = await parse(c, z.object({ text: z.string().trim().min(1).max(TRANSCRIPT_LIMITS.maxChars).optional() }));
    const db = c.get('db');
    const { ws, pid } = ids(c as never);
    const jobId = c.req.param('jobId') ?? '';
    const job = await loadJob(db, jobId, ws, pid);
    if (job.status !== 'waiting_review' || !job.payloadJson) {
      throw new HttpError(409, ERROR_CODES.INVALID_STATE, `Job is ${job.status}; this action is not allowed now.`);
    }
    const draft = JSON.parse(job.payloadJson) as Draft;
    if (edit.text !== undefined) {
      if (draft.segments.length) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Text with timestamps cannot be edited here.');
      draft.text = edit.text;
    }
    const period = new Date().toISOString().slice(0, 7);
    const used = await countOf(
      db
        .select({ n: sql<number>`coalesce(sum(${usageRecords.amount}), 0)` })
        .from(usageRecords)
        .where(and(eq(usageRecords.workspaceId, ws), eq(usageRecords.metric, 'transcripts'), eq(usageRecords.period, period)))
        .get(),
    );
    await quota(db, 'quota.transcripts_per_month', 200, used, 'transcripts per month');

    // Reserva a transição primeiro: se outra aba aprovar ao mesmo tempo, só uma passa.
    await move(db, jobId, ws, pid, ['waiting_review'], 'completed', { payloadJson: null });
    const tid = crypto.randomUUID();
    const stmts = [
      db.insert(transcripts).values({ id: tid, workspaceId: ws, projectId: pid, origin: job.origin ?? 'pasted', language: draft.language, bodyText: draft.text }),
      db.update(processingJobs).set({ transcriptId: tid }).where(eq(processingJobs.id, jobId)),
      db.insert(usageRecords).values({ workspaceId: ws, metric: 'transcripts', amount: 1, period }),
    ];
    for (let i = 0; i < draft.segments.length; i += 15) {
      stmts.push(
        db.insert(transcriptSegments).values(
          draft.segments.slice(i, i + 15).map((s, k) => ({ transcriptId: tid, idx: i + k, startMs: s.startMs, endMs: s.endMs, text: s.text })),
        ) as never,
      );
    }
    await db.batch(stmts as never);
    await audit(db, { action: 'transcript.create', userId: c.get('user').id, workspaceId: ws, targetKind: 'transcript', targetId: tid, ipHash: c.get('ipHash'), metadata: { origin: job.origin, segments: draft.segments.length } });
    return c.json({ id: jobId, status: 'completed', transcriptId: tid });
  });

  // ---------- transcrições concluídas ----------
  const T = `${P}/transcripts`;
  r.get(T, async (c) => {
    const { ws, pid } = ids(c as never);
    const rows = await c
      .get('db')
      .select({ id: transcripts.id, origin: transcripts.origin, language: transcripts.language, chars: sql<number>`length(${transcripts.bodyText})`, createdAt: transcripts.createdAt })
      .from(transcripts)
      .where(and(eq(transcripts.projectId, pid), eq(transcripts.workspaceId, ws)))
      .orderBy(desc(transcripts.createdAt))
      .all();
    return c.json({ transcripts: rows });
  });

  r.get(`${T}/:transcriptId`, async (c) => {
    const { ws, pid } = ids(c as never);
    const db = c.get('db');
    const t = await db
      .select()
      .from(transcripts)
      .where(and(eq(transcripts.id, c.req.param('transcriptId') ?? ''), eq(transcripts.projectId, pid), eq(transcripts.workspaceId, ws)))
      .get();
    if (!t) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    const segs = await db.select({ idx: transcriptSegments.idx, startMs: transcriptSegments.startMs, endMs: transcriptSegments.endMs, text: transcriptSegments.text }).from(transcriptSegments).where(eq(transcriptSegments.transcriptId, t.id)).orderBy(transcriptSegments.idx).all();
    return c.json({ id: t.id, origin: t.origin, language: t.language, text: t.bodyText, segments: segs, createdAt: t.createdAt });
  });

  r.delete(`${T}/:transcriptId`, async (c) => {
    const { ws, pid } = ids(c as never);
    const db = c.get('db');
    const row = await db
      .delete(transcripts)
      .where(and(eq(transcripts.id, c.req.param('transcriptId') ?? ''), eq(transcripts.projectId, pid), eq(transcripts.workspaceId, ws)))
      .returning({ id: transcripts.id })
      .get();
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    await audit(db, { action: 'transcript.delete', userId: c.get('user').id, workspaceId: ws, targetKind: 'transcript', targetId: row.id, ipHash: c.get('ipHash') });
    return c.body(null, 204);
  });
}
