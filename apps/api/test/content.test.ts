import { describe, expect, it } from 'vitest';
import { AUTH_KEY_A, AUTH_KEY_B, json, register, rows, setup, type Harness } from './helpers';

async function tenant(h: Harness, email: string, key: string) {
  const { cookie } = await register(h, email, key);
  const me = (await (await h.call('/api/auth/me', { cookie })).json()) as { workspaces: { id: string }[] };
  const ws = me.workspaces[0]?.id as string;
  const client = rows<{ id: string }>(h.raw, 'select id from clients where workspace_id = ?', ws)[0]?.id as string;
  return { ws, client, cookie, base: `/api/workspaces/${ws}/clients/${client}` };
}
const post = (h: Harness, cookie: string, path: string, body: unknown, method = 'POST') =>
  h.call(path, { method, cookie, body: json(body) });

async function newProject(h: Harness, t: Awaited<ReturnType<typeof tenant>>) {
  const res = await post(h, t.cookie, `${t.base}/projects`, { name: 'Meu projeto' });
  expect(res.status).toBe(201);
  const p = (await res.json()) as { id: string };
  return { id: p.id, url: `${t.base}/projects/${p.id}` };
}

describe('clients e projects', () => {
  it('CRUD básico + cliente implícito protegido', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const c = await post(h, t.cookie, `/api/workspaces/${t.ws}/clients`, { name: 'Acme' });
    expect(c.status).toBe(201);
    const { id } = (await c.json()) as { id: string };
    expect((await post(h, t.cookie, `/api/workspaces/${t.ws}/clients/${id}`, { name: 'Acme 2' }, 'PATCH')).status).toBe(200);
    expect((await h.call(`/api/workspaces/${t.ws}/clients/${id}`, { method: 'DELETE', cookie: t.cookie })).status).toBe(204);
    expect((await h.call(`/api/workspaces/${t.ws}/clients/${t.client}`, { method: 'DELETE', cookie: t.cookie })).status).toBe(400);

    const p = await newProject(h, t);
    expect((await post(h, t.cookie, p.url, { name: 'Novo nome', status: 'archived' }, 'PATCH')).status).toBe(200);
    const list = (await (await h.call(`${t.base}/projects`, { cookie: t.cookie })).json()) as { projects: { name: string; status: string }[] };
    expect(list.projects[0]).toMatchObject({ name: 'Novo nome', status: 'archived' });
    expect((await post(h, t.cookie, `${t.base}/projects`, { name: '  ' })).status).toBe(400);
    expect((await h.call(p.url, { method: 'DELETE', cookie: t.cookie })).status).toBe(204);
    expect((await h.call(p.url, { cookie: t.cookie })).status).toBe(404);
  });

  it('quotas de clients e projects (409 quota_exceeded)', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    h.raw.prepare("update system_settings set value='2' where key='quota.clients_per_workspace'").run();
    h.raw.prepare("update system_settings set value='1' where key='quota.projects_per_workspace'").run();
    expect((await post(h, t.cookie, `/api/workspaces/${t.ws}/clients`, { name: 'B' })).status).toBe(201);
    const over = await post(h, t.cookie, `/api/workspaces/${t.ws}/clients`, { name: 'C' });
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
    await newProject(h, t);
    expect((await post(h, t.cookie, `${t.base}/projects`, { name: 'x' })).status).toBe(409);
  });

  it('role member não administra clients nem apaga projetos', async () => {
    const h = setup();
    const owner = await tenant(h, 'o@x.com', AUTH_KEY_A);
    const m = await tenant(h, 'm@x.com', AUTH_KEY_B);
    const mUser = rows<{ id: string }>(h.raw, 'select id from users where email = ?', 'm@x.com')[0]?.id as string;
    h.raw.prepare("insert into workspace_members (id, workspace_id, user_id, role) values (?,?,?,'member')").run(crypto.randomUUID(), owner.ws, mUser);
    expect((await post(h, m.cookie, `/api/workspaces/${owner.ws}/clients`, { name: 'x' })).status).toBe(403);
    const p = await newProject(h, owner);
    expect((await h.call(p.url, { method: 'DELETE', cookie: m.cookie })).status).toBe(403);
    expect((await post(h, m.cookie, `${owner.base}/projects`, { name: 'by member' })).status).toBe(201);
  });
});

describe('source, outputs e export', () => {
  it('fluxo completo: source → outputs (forçados a template) → edição com versão → export', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const p = await newProject(h, t);

    const analysis = {
      version: 1,
      language: 'pt',
      keywords: ['energia solar'],
      summary: ['Frase.'],
      stats: { chars: 10, words: 2, sentences: 1 },
      algorithms: { language: 'franc-min', keywords: 'yake-inspired@1', summary: 'textrank-tfidf@1' },
    };
    expect((await post(h, t.cookie, `${p.url}/source`, { kind: 'paste', text: 'Texto de teste.', analysis }, 'PUT')).status).toBe(200);
    expect((await post(h, t.cookie, `${p.url}/source`, { kind: 'exe', text: 'x' }, 'PUT')).status).toBe(400);
    expect((await post(h, t.cookie, `${p.url}/source`, { kind: 'paste', text: 'x'.repeat(200_001) }, 'PUT')).status).toBe(400);
    const detail = (await (await h.call(p.url, { cookie: t.cookie })).json()) as { source: { chars: number; analysis: { language: string } } };
    expect(detail.source.chars).toBe(15);
    expect(detail.source.analysis.language).toBe('pt');

    // cliente tenta forjar sourceKind: é ignorado (zod strip) e o servidor grava 'template'
    const created = await post(h, t.cookie, `${p.url}/outputs`, {
      outputs: [{ kind: 'post', body: 'corpo', sourceKind: 'ai_external' }],
    });
    expect(created.status).toBe(201);
    const [o] = ((await created.json()) as { outputs: { id: string; sourceKind: string }[] }).outputs;
    expect(o?.sourceKind).toBe('template');
    expect(rows<{ source_kind: string }>(h.raw, 'select source_kind from content_outputs')[0]?.source_kind).toBe('template');
    expect((await post(h, t.cookie, `${p.url}/outputs`, { outputs: [{ kind: 'video', body: 'x' }] })).status).toBe(400);

    const ok = await post(h, t.cookie, `${p.url}/outputs/${o?.id}`, { body: 'editado', version: 1 }, 'PATCH');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { version: number }).version).toBe(2);
    const stale = await post(h, t.cookie, `${p.url}/outputs/${o?.id}`, { body: 'outro', version: 1 }, 'PATCH');
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('version_conflict');
    expect((await post(h, t.cookie, `${p.url}/outputs/${crypto.randomUUID()}`, { body: 'x', version: 1 }, 'PATCH')).status).toBe(404);

    const ex = (await (await h.call(`${p.url}/export-data`, { cookie: t.cookie })).json()) as {
      schema: string; schemaVersion: number; outputs: { body: string; version: number; sourceKind: string }[];
    };
    expect(ex.schema).toBe('contentflow.export');
    expect(ex.schemaVersion).toBe(1);
    expect(ex.outputs[0]).toMatchObject({ body: 'editado', version: 2, sourceKind: 'template' });
    expect(rows(h.raw, "select 1 from usage_records where metric='exports'")).toHaveLength(1);
    expect(rows(h.raw, "select 1 from audit_logs where action='project.export'")).toHaveLength(1);

    expect((await h.call(`${p.url}/outputs/${o?.id}`, { method: 'DELETE', cookie: t.cookie })).status).toBe(204);
    expect((await h.call(`${p.url}/outputs/${o?.id}`, { method: 'DELETE', cookie: t.cookie })).status).toBe(404);
  });

  it('quota mensal de exports e de outputs por projeto', async () => {
    const h = setup();
    const t = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const p = await newProject(h, t);
    h.raw.prepare("update system_settings set value='1' where key='quota.exports_per_month'").run();
    h.raw.prepare("update system_settings set value='2' where key='quota.outputs_per_project'").run();
    expect((await h.call(`${p.url}/export-data`, { cookie: t.cookie })).status).toBe(200);
    expect((await h.call(`${p.url}/export-data`, { cookie: t.cookie })).status).toBe(409);
    const three = { outputs: [1, 2, 3].map(() => ({ kind: 'post', body: 'x' })) };
    expect((await post(h, t.cookie, `${p.url}/outputs`, three)).status).toBe(409);
  });

  it('isolamento: B não lê, escreve nem exporta projeto de A (404)', async () => {
    const h = setup();
    const a = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const b = await tenant(h, 'b@x.com', AUTH_KEY_B);
    const p = await newProject(h, a);
    const created = await post(h, a.cookie, `${p.url}/outputs`, { outputs: [{ kind: 'post', body: 'segredo' }] });
    const [o] = ((await created.json()) as { outputs: { id: string }[] }).outputs;

    const probes: [string, string, unknown?][] = [
      ['GET', p.url], ['PATCH', p.url, { name: 'x' }], ['DELETE', p.url],
      ['PUT', `${p.url}/source`, { kind: 'paste', text: 'x' }],
      ['GET', `${p.url}/outputs`], ['POST', `${p.url}/outputs`, { outputs: [{ kind: 'post', body: 'x' }] }],
      ['PATCH', `${p.url}/outputs/${o?.id}`, { body: 'x', version: 1 }], ['DELETE', `${p.url}/outputs/${o?.id}`],
      ['GET', `${p.url}/export-data`], ['POST', `${a.base}/projects`, { name: 'x' }], ['GET', `${a.base}/projects`],
      ['POST', `/api/workspaces/${a.ws}/clients`, { name: 'x' }],
    ];
    for (const [method, path, body] of probes) {
      const res = await h.call(path, { method, cookie: b.cookie, body: body ? json(body) : undefined });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // B usando o próprio workspace com ids de A também não alcança
    const cross = await h.call(`${b.base}/projects/${p.id}/outputs`, { cookie: b.cookie });
    expect(cross.status).toBe(404);
    expect(rows(h.raw, 'select body from content_outputs')[0]).toMatchObject({ body: 'segredo' });
  });
});
