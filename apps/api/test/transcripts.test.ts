import { describe, expect, it } from 'vitest';
import { cleanup } from '../src/jobs/cleanup';
import { AUTH_KEY_A, AUTH_KEY_B, json, register, rows, setup, type Harness } from './helpers';

async function tenant(h: Harness, email: string, key: string) {
  const { cookie } = await register(h, email, key);
  const me = (await (await h.call('/api/auth/me', { cookie })).json()) as { workspaces: { id: string }[] };
  const ws = me.workspaces[0]?.id as string;
  const client = rows<{ id: string }>(h.raw, 'select id from clients where workspace_id = ?', ws)[0]?.id as string;
  const res = await h.call(`/api/workspaces/${ws}/clients/${client}/projects`, { method: 'POST', cookie, body: json({ name: 'p' }) });
  const { id } = (await res.json()) as { id: string };
  return { ws, cookie, url: `/api/workspaces/${ws}/clients/${client}/projects/${id}` };
}
type T = Awaited<ReturnType<typeof tenant>>;
const post = (h: Harness, t: T, path: string, body: unknown = {}, method = 'POST') => h.call(`${t.url}${path}`, { method, cookie: t.cookie, body: json(body) });
const get = (h: Harness, t: T, path: string) => h.call(`${t.url}${path}`, { cookie: t.cookie });
const status = async (h: Harness, t: T, id: string) => ((await (await get(h, t, `/transcript-jobs/${id}`)).json()) as { status: string }).status;
const SEGS = [
  { startMs: 0, endMs: 1500, text: 'Primeira fala.' },
  { startMs: 1500, endMs: 4000, text: 'Segunda fala.' },
];

describe('pipeline de transcrição colada', () => {
  it('submitted → validating → waiting_review → completed, com revisão editável', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const c = await post(h, t, '/transcript-jobs', { origin: 'pasted', text: 'Texto colado.', language: 'pt' });
    expect(c.status).toBe(201);
    const { id, status: st } = (await c.json()) as { id: string; status: string };
    expect(st).toBe('waiting_review');
    const review = (await (await get(h, t, `/transcript-jobs/${id}`)).json()) as { draft: { text: string } };
    expect(review.draft.text).toBe('Texto colado.');

    const ok = await post(h, t, `/transcript-jobs/${id}/approve`, { text: 'Texto colado e revisado.' });
    expect(ok.status).toBe(200);
    expect(await status(h, t, id)).toBe('completed');
    const job = rows<{ payload_json: string | null; transcript_id: string }>(h.raw, 'select payload_json, transcript_id from processing_jobs where id = ?', id)[0];
    expect(job?.payload_json).toBeNull(); // rascunho apagado
    const tr = (await (await get(h, t, `/transcripts/${job?.transcript_id}`)).json()) as { text: string; origin: string; segments: unknown[] };
    expect(tr).toMatchObject({ text: 'Texto colado e revisado.', origin: 'pasted', segments: [] });
    expect(rows(h.raw, "select 1 from usage_records where metric='transcripts'")).toHaveLength(1);
    expect(rows(h.raw, "select 1 from audit_logs where action='transcript.create'")).toHaveLength(1);
  });

  it('estados terminais não voltam: aprovar duas vezes, cancelar depois de concluir (409 invalid_state)', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const { id } = (await (await post(h, t, '/transcript-jobs', { origin: 'pasted', text: 'x' })).json()) as { id: string };
    expect((await post(h, t, `/transcript-jobs/${id}/approve`)).status).toBe(200);
    for (const a of ['approve', 'cancel', 'submit', 'fail']) {
      const res = await post(h, t, `/transcript-jobs/${id}/${a}`, a === 'submit' ? { text: 'y' } : a === 'fail' ? { code: 'wasm_failed' } : {});
      expect(res.status, a).toBe(409);
    }
    expect(rows(h.raw, 'select 1 from transcripts')).toHaveLength(1);
  });

  it('cancelar em revisão apaga o rascunho e não grava transcrição nem quota', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const { id } = (await (await post(h, t, '/transcript-jobs', { origin: 'pasted', text: 'x' })).json()) as { id: string };
    expect((await post(h, t, `/transcript-jobs/${id}/cancel`)).status).toBe(200);
    expect(await status(h, t, id)).toBe('canceled');
    expect(rows(h.raw, 'select payload_json from processing_jobs')[0]).toMatchObject({ payload_json: null });
    expect(rows(h.raw, 'select 1 from transcripts')).toHaveLength(0);
    expect(rows(h.raw, "select 1 from usage_records where metric='transcripts'")).toHaveLength(0);
  });
});

describe('SRT/VTT com segmentos', () => {
  it('persiste segmentos com timestamps; texto vem dos segmentos (servidor não confia no texto do cliente)', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const c = await post(h, t, '/transcript-jobs', { origin: 'srt', segments: SEGS, text: 'IGNORADO' });
    const { id } = (await c.json()) as { id: string };
    // segmentos não podem ter o texto editado na revisão
    expect((await post(h, t, `/transcript-jobs/${id}/approve`, { text: 'outro' })).status).toBe(400);
    const ok = (await (await post(h, t, `/transcript-jobs/${id}/approve`)).json()) as { transcriptId: string };
    const tr = (await (await get(h, t, `/transcripts/${ok.transcriptId}`)).json()) as { text: string; segments: { idx: number; startMs: number; endMs: number; text: string }[] };
    expect(tr.text).toBe('Primeira fala.\nSegunda fala.');
    const listed = (await (await get(h, t, '/transcripts')).json()) as { transcripts: { segments: number }[] };
    expect(listed.transcripts[0]?.segments).toBe(2); // a UI usa isso para habilitar cortes e SRT/VTT
    expect(tr.segments).toEqual([
      { idx: 0, startMs: 0, endMs: 1500, text: 'Primeira fala.' },
      { idx: 1, startMs: 1500, endMs: 4000, text: 'Segunda fala.' },
    ]);
  });

  it('muitos segmentos (inserção em lotes) e validação de ordem/tempo', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const many = Array.from({ length: 100 }, (_, i) => ({ startMs: i * 1000, endMs: i * 1000 + 900, text: `fala ${i}` }));
    const { id } = (await (await post(h, t, '/transcript-jobs', { origin: 'vtt', segments: many })).json()) as { id: string };
    await post(h, t, `/transcript-jobs/${id}/approve`);
    expect(rows(h.raw, 'select count(*) n from transcript_segments')[0]).toMatchObject({ n: 100 });

    const bad = [
      [{ startMs: 5000, endMs: 1000, text: 'x' }],
      [{ startMs: 5000, endMs: 6000, text: 'a' }, { startMs: 0, endMs: 1, text: 'b' }],
      [{ startMs: 0, endMs: 1, text: '   ' }],
    ];
    for (const segments of bad) expect((await post(h, t, '/transcript-jobs', { origin: 'srt', segments })).status).toBe(400);
    expect((await post(h, t, '/transcript-jobs', { origin: 'srt', segments: Array.from({ length: 1001 }, () => SEGS[0]) })).status).toBe(400);
    expect((await post(h, t, '/transcript-jobs', { origin: 'pasted', text: 'x'.repeat(200_001) })).status).toBe(400);
    expect((await post(h, t, '/transcript-jobs', { origin: 'mp3', text: 'x' })).status).toBe(400);
  });
});

describe('WASM (o Worker só orquestra estados)', () => {
  it('running → submit → waiting_review → completed com source origin wasm', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const { id, status: s0 } = (await (await post(h, t, '/transcript-jobs', { origin: 'wasm' })).json()) as { id: string; status: string };
    expect(s0).toBe('running');
    expect((await post(h, t, `/transcript-jobs/${id}/approve`)).status).toBe(409); // ainda não há rascunho
    expect((await post(h, t, `/transcript-jobs/${id}/submit`, { segments: SEGS, language: 'pt' })).status).toBe(200);
    expect(await status(h, t, id)).toBe('waiting_review');
    const ok = (await (await post(h, t, `/transcript-jobs/${id}/approve`)).json()) as { transcriptId: string };
    expect(rows(h.raw, 'select origin, language from transcripts where id = ?', ok.transcriptId)[0]).toMatchObject({ origin: 'wasm', language: 'pt' });
  });

  it('falha informada pelo navegador e resultado inválido vão para failed e apagam rascunho', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const a = (await (await post(h, t, '/transcript-jobs', { origin: 'wasm' })).json()) as { id: string };
    expect((await post(h, t, `/transcript-jobs/${a.id}/fail`, { code: 'wasm_out_of_memory' })).status).toBe(200);
    expect(rows(h.raw, 'select status, error_code from processing_jobs where id = ?', a.id)[0]).toMatchObject({ status: 'failed', error_code: 'wasm_out_of_memory' });
    expect((await post(h, t, `/transcript-jobs/${a.id}/fail`, { code: 'wasm_failed' })).status).toBe(409);

    const b = (await (await post(h, t, '/transcript-jobs', { origin: 'wasm' })).json()) as { id: string };
    expect((await post(h, t, `/transcript-jobs/${b.id}/fail`, { code: 'segredo' })).status).toBe(400);
    const bad = await post(h, t, `/transcript-jobs/${b.id}/submit`, { segments: [{ startMs: 9, endMs: 1, text: 'x' }] });
    expect(bad.status).toBe(400);
    expect(rows(h.raw, 'select status, error_code from processing_jobs where id = ?', b.id)[0]).toMatchObject({ status: 'failed', error_code: 'invalid_result' });
  });

  it('submit só vale para jobs wasm', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const { id } = (await (await post(h, t, '/transcript-jobs', { origin: 'pasted', text: 'x' })).json()) as { id: string };
    expect((await post(h, t, `/transcript-jobs/${id}/submit`, { text: 'y' })).status).toBe(409);
  });
});

describe('quotas, cron e isolamento', () => {
  it('quota mensal de transcrições e limite de jobs abertos', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    h.raw.prepare("update system_settings set value='1' where key='quota.transcripts_per_month'").run();
    h.raw.prepare("update system_settings set value='2' where key='quota.active_jobs_per_project'").run();
    const mk = async () => (await (await post(h, t, '/transcript-jobs', { origin: 'pasted', text: 'x' })).json()) as { id: string };
    const a = await mk();
    const b = await mk();
    const third = await post(h, t, '/transcript-jobs', { origin: 'pasted', text: 'x' });
    expect(third.status).toBe(409);
    expect(((await third.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
    expect((await post(h, t, `/transcript-jobs/${a.id}/approve`)).status).toBe(200);
    const over = await post(h, t, `/transcript-jobs/${b.id}/approve`);
    expect(over.status).toBe(409);
    expect(await status(h, t, b.id)).toBe('waiting_review'); // nada foi consumido
  });

  it('cron cancela jobs abandonados e apaga rascunho', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const { id } = (await (await post(h, t, '/transcript-jobs', { origin: 'pasted', text: 'x' })).json()) as { id: string };
    await cleanup(h.d1, Date.now() + 8 * 86_400_000);
    expect(rows(h.raw, 'select status, error_code, payload_json from processing_jobs where id = ?', id)[0]).toMatchObject({ status: 'canceled', error_code: 'stale', payload_json: null });
  });

  it('B não vê nem mexe nos jobs/transcrições de A (404)', async () => {
    const h = setup();
    const a = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const b = await tenant(h, 'b@x.com', AUTH_KEY_B);
    const { id } = (await (await post(h, a, '/transcript-jobs', { origin: 'srt', segments: SEGS })).json()) as { id: string };
    const done = (await (await post(h, a, `/transcript-jobs/${id}/approve`)).json()) as { transcriptId: string };
    const w = (await (await post(h, a, '/transcript-jobs', { origin: 'pasted', text: 'z' })).json()) as { id: string };

    const probes: [string, string, unknown?][] = [
      ['GET', '/transcript-jobs'], ['POST', '/transcript-jobs', { origin: 'pasted', text: 'x' }],
      ['GET', `/transcript-jobs/${w.id}`], ['POST', `/transcript-jobs/${w.id}/approve`], ['POST', `/transcript-jobs/${w.id}/cancel`],
      ['POST', `/transcript-jobs/${w.id}/submit`, { text: 'x' }], ['POST', `/transcript-jobs/${w.id}/fail`, { code: 'wasm_failed' }],
      ['GET', '/transcripts'], ['GET', `/transcripts/${done.transcriptId}`], ['DELETE', `/transcripts/${done.transcriptId}`],
    ];
    for (const [method, path, body] of probes) {
      const res = await h.call(`${a.url}${path}`, { method, cookie: b.cookie, body: body ? json(body) : undefined });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // mesmo usando o próprio projeto com ids de A
    expect((await h.call(`${b.url}/transcripts/${done.transcriptId}`, { cookie: b.cookie })).status).toBe(404);
    expect((await h.call(`${b.url}/transcript-jobs/${w.id}`, { cookie: b.cookie })).status).toBe(404);
    expect(await status(h, a, w.id)).toBe('waiting_review');
    expect(rows(h.raw, 'select 1 from transcripts')).toHaveLength(1);
  });

  it('excluir transcrição apaga os segmentos (cascade)', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const { id } = (await (await post(h, t, '/transcript-jobs', { origin: 'srt', segments: SEGS })).json()) as { id: string };
    const { transcriptId } = (await (await post(h, t, `/transcript-jobs/${id}/approve`)).json()) as { transcriptId: string };
    expect((await h.call(`${t.url}/transcripts/${transcriptId}`, { method: 'DELETE', cookie: t.cookie })).status).toBe(204);
    expect(rows(h.raw, 'select 1 from transcript_segments')).toHaveLength(0);
    expect(rows(h.raw, 'select transcript_id from processing_jobs')[0]).toMatchObject({ transcript_id: null });
  });
});
