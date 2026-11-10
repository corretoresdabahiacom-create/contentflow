import { describe, expect, it } from 'vitest';
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
const call = (h: Harness, t: T, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
  h.call(`${t.url}${path}`, { method, cookie: t.cookie, body: body === undefined ? undefined : json(body) });
const clip = (o: object = {}) => ({ startMs: 1000, endMs: 20_000, title: 'Corte', justification: 'Contém 1 pergunta(s).', excerpt: 'trecho', ...o });
type Clip = { id: string; version: number; edited: boolean; origin: string; title: string; startMs: number; notes: string | null };
const list = async (h: Harness, t: T) => ((await (await call(h, t, '/clips')).json()) as { clips: Clip[] }).clips;

describe('clips', () => {
  it('cria em lote, lista ordenado e guarda sinais', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const res = await call(h, t, '/clips', { clips: [clip({ startMs: 50_000, endMs: 70_000, title: 'B' }), clip({ title: 'A', signals: { questions: 1 } })] });
    expect(res.status).toBe(201);
    const l = await list(h, t);
    expect(l.map((c) => c.title)).toEqual(['A', 'B']);
    expect(l[0]).toMatchObject({ edited: false, version: 1, origin: 'heuristic' });
  });

  it('valida intervalo, tamanhos e transcriptId inexistente', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    for (const bad of [clip({ startMs: 5000, endMs: 5000 }), clip({ startMs: -1 }), clip({ title: ' ' }), clip({ justification: '' }), clip({ endMs: 99 * 3_600_000 }), clip({ origin: 'ai' })])
      expect((await call(h, t, '/clips', { clips: [bad] })).status).toBe(400);
    expect((await call(h, t, '/clips', { clips: [clip({ transcriptId: crypto.randomUUID() })] })).status).toBe(404);
    expect((await call(h, t, '/clips', { clips: [] })).status).toBe(400);
    expect(await list(h, t)).toHaveLength(0);
  });

  it('edição manual marca edited, incrementa versão e detecta conflito (409)', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    await call(h, t, '/clips', { clips: [clip()] });
    const [c] = await list(h, t);
    const ok = await call(h, t, `/clips/${c?.id}`, { title: 'Novo título', notes: 'nota', startMs: 2000, endMs: 30_000, version: 1 }, 'PATCH');
    expect(ok.status).toBe(200);
    expect(await list(h, t)).toMatchObject([{ title: 'Novo título', notes: 'nota', startMs: 2000, edited: true, version: 2 }]);
    const stale = await call(h, t, `/clips/${c?.id}`, { title: 'x', version: 1 }, 'PATCH');
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('version_conflict');
    // só início sem fim, ou intervalo invertido, são recusados
    expect((await call(h, t, `/clips/${c?.id}`, { startMs: 1, version: 2 }, 'PATCH')).status).toBe(400);
    expect((await call(h, t, `/clips/${c?.id}`, { startMs: 9000, endMs: 1000, version: 2 }, 'PATCH')).status).toBe(400);
    expect((await call(h, t, `/clips/${crypto.randomUUID()}`, { title: 'x', version: 1 }, 'PATCH')).status).toBe(404);
  });

  it('regenerar substitui só sugestões automáticas não editadas; manuais e editadas ficam', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    await call(h, t, '/clips', { clips: [clip({ title: 'auto1' }), clip({ title: 'auto2', startMs: 30_000, endMs: 50_000 }), clip({ title: 'manual', origin: 'manual', startMs: 60_000, endMs: 80_000 })] });
    const auto2 = (await list(h, t)).find((c) => c.title === 'auto2');
    await call(h, t, `/clips/${auto2?.id}`, { notes: 'editei', version: 1 }, 'PATCH');
    await call(h, t, '/clips', { clips: [clip({ title: 'nova' })], replaceHeuristic: true });
    expect((await list(h, t)).map((c) => c.title).sort()).toEqual(['auto2', 'manual', 'nova']);
  });

  it('quota de clips por projeto e exclusão', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    h.raw.prepare("update system_settings set value='2' where key='quota.clips_per_project'").run();
    expect((await call(h, t, '/clips', { clips: [clip(), clip()] })).status).toBe(201);
    const over = await call(h, t, '/clips', { clips: [clip()] });
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
    // substituir automáticas cabe na quota
    expect((await call(h, t, '/clips', { clips: [clip(), clip()], replaceHeuristic: true })).status).toBe(201);
    const [c] = await list(h, t);
    expect((await call(h, t, `/clips/${c?.id}`, undefined, 'DELETE')).status).toBe(204);
    expect((await call(h, t, `/clips/${c?.id}`, undefined, 'DELETE')).status).toBe(404);
  });

  it('isolamento: B não lê, cria, edita, apaga nem aponta transcrição de A', async () => {
    const h = setup();
    const a = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const b = await tenant(h, 'b@x.com', AUTH_KEY_B);
    await call(h, a, '/clips', { clips: [clip()] });
    const [c] = await list(h, a);
    const seg = [{ startMs: 0, endMs: 1000, text: 'x' }];
    const job = (await (await call(h, a, '/transcript-jobs', { origin: 'srt', segments: seg })).json()) as { id: string };
    const tr = (await (await call(h, a, `/transcript-jobs/${job.id}/approve`, {})).json()) as { transcriptId: string };

    for (const [method, path, body] of [
      ['GET', '/clips'], ['POST', '/clips', { clips: [clip()] }], ['PATCH', `/clips/${c?.id}`, { title: 'x', version: 1 }], ['DELETE', `/clips/${c?.id}`],
    ] as [string, string, unknown?][]) {
      const res = await h.call(`${a.url}${path}`, { method, cookie: b.cookie, body: body ? json(body) : undefined });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // no projeto de B, com id de clip de A e transcrição de A
    expect((await call(h, b, `/clips/${c?.id}`, { title: 'x', version: 1 }, 'PATCH')).status).toBe(404);
    expect((await call(h, b, `/clips/${c?.id}`, undefined, 'DELETE')).status).toBe(404);
    expect((await call(h, b, '/clips', { clips: [clip({ transcriptId: tr.transcriptId })] })).status).toBe(404);
    expect(await list(h, a)).toMatchObject([{ title: 'Corte', version: 1 }]);
  });
});

describe('canais e export (Fase 4)', () => {
  it('outputs só aceitam canais conhecidos e continuam sendo template', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const ok = await call(h, t, '/outputs', { outputs: [{ channel: 'instagram', kind: 'caption', body: 'oi #x' }, { channel: 'youtube', kind: 'title', body: 'T' }] });
    expect(ok.status).toBe(201);
    expect(rows<{ channel: string; source_kind: string }>(h.raw, 'select channel, source_kind from content_outputs order by channel').map((r) => `${r.channel}:${r.source_kind}`)).toEqual(['instagram:template', 'youtube:template']);
    expect((await call(h, t, '/outputs', { outputs: [{ channel: 'myspace', kind: 'post', body: 'x' }] })).status).toBe(400);
  });

  it('export-data inclui clips e a transcrição com timestamps', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const seg = [{ startMs: 0, endMs: 1500, text: 'Olá.' }, { startMs: 1500, endMs: 3000, text: 'Mundo.' }];
    const job = (await (await call(h, t, '/transcript-jobs', { origin: 'vtt', segments: seg })).json()) as { id: string };
    await call(h, t, `/transcript-jobs/${job.id}/approve`, {});
    await call(h, t, '/clips', { clips: [clip({ notes: 'n' })] });
    const doc = (await (await call(h, t, '/export-data')).json()) as { clips: { title: string; notes: string }[]; transcript: { origin: string; segments: unknown[] } };
    expect(doc.clips).toMatchObject([{ title: 'Corte', notes: 'n' }]);
    expect(doc.transcript.origin).toBe('vtt');
    expect(doc.transcript.segments).toHaveLength(2);
  });
});
