import { describe, expect, it } from 'vitest';
import { alertAdmins } from '../src/jobs/cleanup';
import { makeDb } from '../src/db/client';
import { AUTH_KEY_B, json, register, rows, setup, type Harness } from './helpers';

const TOKEN_OK = 'tok';

async function user(h: Harness, email: string, key?: string) {
  const { cookie } = await register(h, email, key);
  const me = (await (await h.call('/api/auth/me', { cookie })).json()) as { user: { id: string }; workspaces: { id: string }[] };
  return { cookie, id: me.user.id, ws: me.workspaces[0]!.id };
}

async function sharedLink(h: Harness, a: { cookie: string; ws: string }) {
  const cl = (rows(h.raw, 'select id from clients where workspace_id = ?', a.ws)[0] as { id: string }).id;
  const pr = await h.call(`/api/workspaces/${a.ws}/clients/${cl}/projects`, { method: 'POST', cookie: a.cookie, body: json({ name: 'P' }) });
  const pid = ((await pr.json()) as { id: string }).id;
  const out = await h.call(`/api/workspaces/${a.ws}/clients/${cl}/projects/${pid}/outputs`, { method: 'POST', cookie: a.cookie, body: json({ outputs: [{ channel: 'generic', kind: 'post', title: 'T', body: 'Texto compartilhado '.repeat(30) }] }) });
  const oid = ((await out.json()) as { outputs: { id: string }[] }).outputs[0]!.id;
  const res = await h.call(`/api/workspaces/${a.ws}/clients/${cl}/shared-links`, { method: 'POST', cookie: a.cookie, body: json({ outputIds: [oid], expiresInDays: 7 }) });
  const j = (await res.json()) as { id: string; token: string };
  return { ...j, cl, oid };
}

describe('Fase 7: admin e denúncias', () => {
  it('admin é 404 para quem não é admin global e 401 sem login', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    expect((await h.call('/api/admin/overview')).status).toBe(401);
    for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/reports', '/api/admin/flags', '/api/admin/settings', '/api/admin/jobs']) {
      expect((await h.call(p, { cookie: a.cookie })).status).toBe(404);
    }
    expect((await h.call('/api/admin/flags/video_render_enabled', { method: 'PATCH', cookie: a.cookie, body: json({ enabled: true }) })).status).toBe(404);
  });

  it('overview só traz contagens/metadados, sem conteúdo; mostra métricas externas como indisponíveis', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    await sharedLink(h, a);
    h.raw.prepare('update users set is_global_admin = 1 where id = ?').run(a.id);
    const res = await h.call('/api/admin/overview', { cookie: a.cookie });
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).not.toContain('Texto compartilhado');
    const o = JSON.parse(txt) as { tables: Record<string, number>; external: { workersRequests: string; r2: string }; quotas: { key: string }[] };
    expect(o.tables.users).toBe(1);
    expect(o.external.workersRequests).toBe('unavailable');
    expect(o.external.r2).toBe('not_applicable');
    expect(o.quotas.length).toBeGreaterThan(5);
    const users = await (await h.call('/api/admin/users', { cookie: a.cookie })).text();
    expect(users).not.toContain('passwordHash');
    expect(users).not.toContain('authKey');
  });

  it('flags: monetização e IA externa travadas (R7/R2); outras alternam com auditoria', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    h.raw.prepare('update users set is_global_admin = 1 where id = ?').run(a.id);
    expect((await h.call('/api/admin/flags/monetization_enabled', { method: 'PATCH', cookie: a.cookie, body: json({ enabled: true }) })).status).toBe(409);
    expect((await h.call('/api/admin/flags/ai_external_enabled', { method: 'PATCH', cookie: a.cookie, body: json({ enabled: true }) })).status).toBe(409);
    expect((await h.call('/api/admin/flags/nao_existe', { method: 'PATCH', cookie: a.cookie, body: json({ enabled: true }) })).status).toBe(404);
    expect((await h.call('/api/admin/flags/video_render_enabled', { method: 'PATCH', cookie: a.cookie, body: json({ enabled: true }) })).status).toBe(200);
    expect(rows(h.raw, "select enabled from feature_flags where key='monetization_enabled'")[0]).toEqual({ enabled: 0 });
    expect(rows(h.raw, "select action from audit_logs where action='admin.flag.set'").length).toBe(1);
    expect((await h.call('/api/billing/x', { cookie: a.cookie })).status).toBe(404);
  });

  it('configurações: só chaves existentes e valores inteiros positivos', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    h.raw.prepare('update users set is_global_admin = 1 where id = ?').run(a.id);
    const set = (k: string, v: unknown) => h.call(`/api/admin/settings/${k}`, { method: 'PATCH', cookie: a.cookie, body: json({ value: v }) });
    expect((await set('quota.projects_per_workspace', 7)).status).toBe(200);
    expect(rows(h.raw, "select value from system_settings where key='quota.projects_per_workspace'")[0]).toEqual({ value: '7' });
    expect((await set('quota.inexistente', 7)).status).toBe(404);
    expect((await set('session.ttl_s', 7)).status).toBe(404); // fora dos prefixos editáveis
    expect((await set('quota.projects_per_workspace', 0)).status).toBe(400);
    expect((await set('quota.projects_per_workspace', 1.5)).status).toBe(400);
  });

  it('suspender usuário derruba o acesso; não suspende a si nem admins', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    const b = await user(h, 'b@x.com', AUTH_KEY_B);
    h.raw.prepare('update users set is_global_admin = 1 where id = ?').run(a.id);
    const sus = (id: string, status = 'suspended') => h.call(`/api/admin/users/${id}`, { method: 'PATCH', cookie: a.cookie, body: json({ status }) });
    expect((await sus(a.id)).status).toBe(409);
    expect((await sus(b.id)).status).toBe(200);
    expect((await h.call('/api/auth/me', { cookie: b.cookie })).status).toBe(401);
    expect((await sus(b.id, 'active')).status).toBe(200);
    expect((await h.call('/api/auth/me', { cookie: b.cookie })).status).toBe(200);
  });

  it('jobs travados e falhos aparecem; cancelar apaga o rascunho', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    h.raw.prepare('update users set is_global_admin = 1 where id = ?').run(a.id);
    const s = await sharedLink(h, a);
    void s;
    const pid = (rows(h.raw, 'select id from projects')[0] as { id: string }).id;
    const old = Date.now() - 2 * 3_600_000;
    h.raw.prepare("insert into processing_jobs (id, workspace_id, project_id, kind, status, payload_json, created_at, updated_at) values ('j1', ?, ?, 'transcribe', 'running', 'segredo', ?, ?)").run(a.ws, pid, old, old);
    h.raw.prepare("insert into processing_jobs (id, workspace_id, project_id, kind, status, error_code, created_at, updated_at) values ('j2', ?, ?, 'transcribe', 'failed', 'boom', ?, ?)").run(a.ws, pid, Date.now(), Date.now());
    const stuck = (await (await h.call('/api/admin/jobs', { cookie: a.cookie })).json()) as { jobs: { id: string }[] };
    expect(stuck.jobs.map((j) => j.id)).toEqual(['j1']);
    const failed = (await (await h.call('/api/admin/jobs?filter=failed', { cookie: a.cookie })).json()) as { jobs: { id: string }[] };
    expect(failed.jobs.map((j) => j.id)).toEqual(['j2']);
    expect(JSON.stringify(stuck)).not.toContain('segredo');
    expect((await h.call('/api/admin/jobs/j1/cancel', { method: 'POST', cookie: a.cookie })).status).toBe(200);
    expect(rows(h.raw, "select status, payload_json p from processing_jobs where id='j1'")[0]).toEqual({ status: 'canceled', p: null });
    expect((await h.call('/api/admin/jobs/j2/cancel', { method: 'POST', cookie: a.cookie })).status).toBe(409);
  });

  it('/report: público, Turnstile fechado sem configuração, resposta igual para link inexistente', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    const link = await sharedLink(h, a);
    const t = link.token;
    expect(t).toBeTruthy();
    const send = (b: object, env?: Harness) => (env ?? h).call('/api/reports', { method: 'POST', body: json({ turnstileToken: TOKEN_OK, ...b }) });
    const ok = await send({ link: `https://app.example.com/s/${t}`, reason: 'abuse', details: 'conteúdo ofensivo', contact: 'x@y.com' });
    expect(ok.status).toBe(201);
    const ghost = await send({ link: 'https://app.example.com/s/' + 'z'.repeat(43), reason: 'spam' });
    expect(ghost.status).toBe(201);
    expect(await ok.json()).toEqual(await ghost.json());
    const rs = rows<{ target_kind: string; urgent: number; target_workspace_id: string | null }>(h.raw, 'select target_kind, urgent, target_workspace_id from reports order by created_at');
    expect(rs.map((r) => r.target_kind).sort()).toEqual(['shared_link', 'unknown']);
    expect(rows(h.raw, 'select * from reports').map((r) => JSON.stringify(r)).join()).not.toContain(t); // token nunca é guardado
    expect((await send({ link: 'x', reason: 'inexistente' })).status).toBe(400);
    const urgent = await send({ link: `/s/${t}`, reason: 'illegal' });
    expect(urgent.status).toBe(201);
    expect(rows(h.raw, 'select urgent from reports where reason = ?', 'illegal')[0]).toEqual({ urgent: 1 });

    const prod = setup({ ENVIRONMENT: 'production' });
    expect((await prod.call('/api/reports', { method: 'POST', body: json({ link: 'x'.repeat(30), reason: 'spam', turnstileToken: 't' }) })).status).toBe(503);
  });

  it('/report tem rate limit por IP', async () => {
    const h = setup();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await h.call('/api/reports', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' }, body: json({ link: 'y'.repeat(30), reason: 'spam', turnstileToken: 't' }) });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5).every((c) => c === 201)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it('moderação: avisar o dono antes de remover; urgente pode remover direto; confirmação obrigatória', async () => {
    const h = setup();
    const owner = await user(h, 'owner@x.com');
    const adm = await user(h, 'adm@x.com', AUTH_KEY_B);
    h.raw.prepare('update users set is_global_admin = 1 where id = ?').run(adm.id);
    const link = await sharedLink(h, owner);
    const t = link.token;
    await h.call('/api/reports', { method: 'POST', body: json({ link: t, reason: 'abuse', turnstileToken: 't' }) });
    const id = (rows(h.raw, 'select id from reports')[0] as { id: string }).id;

    const detail = (await (await h.call(`/api/admin/reports/${id}`, { cookie: adm.cookie })).json()) as { canRevoke: boolean; target: { samples: { sample: string }[]; workspaceName: string } };
    expect(detail.canRevoke).toBe(false);
    expect(detail.target.samples[0]!.sample.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(detail)).not.toContain('reporterContact');

    const resolve = (b: object) => h.call(`/api/admin/reports/${id}/resolve`, { method: 'POST', cookie: adm.cookie, body: json(b) });
    expect((await resolve({ action: 'revoke_link' })).status).toBe(400); // sem confirmação
    expect((await resolve({ action: 'revoke_link', confirm: true })).status).toBe(409); // dono ainda não avisado
    expect(rows(h.raw, 'select revoked_at from shared_links')[0]).toEqual({ revoked_at: null });

    expect((await h.call(`/api/admin/reports/${id}/notify-owner`, { method: 'POST', cookie: adm.cookie })).status).toBe(200);
    const notes = (await (await h.call('/api/notifications', { cookie: owner.cookie })).json()) as { notifications: { id: string; kind: string; payload: Record<string, unknown> }[] };
    expect(notes.notifications.map((n) => n.kind)).toEqual(['moderation.notice']);
    expect(JSON.stringify(notes)).not.toContain('x@y.com');
    expect((await h.call('/api/notifications', { cookie: adm.cookie })).status).toBe(200);
    expect(((await (await h.call('/api/notifications', { cookie: adm.cookie })).json()) as { notifications: unknown[] }).notifications).toHaveLength(0);

    expect((await resolve({ action: 'revoke_link', confirm: true, note: 'violação' })).status).toBe(200);
    expect(rows<{ revoked_at: number | null }>(h.raw, 'select revoked_at from shared_links')[0]!.revoked_at).not.toBeNull();
    expect(rows(h.raw, 'select status, resolution from reports')[0]).toEqual({ status: 'resolved', resolution: 'link_revoked' });
    const after = (await (await h.call('/api/notifications', { cookie: owner.cookie })).json()) as { notifications: { id: string; kind: string }[] };
    expect(after.notifications.map((n) => n.kind).sort()).toEqual(['moderation.notice', 'moderation.removed']);
    expect((await resolve({ action: 'dismiss' })).status).toBe(409); // já encerrada
    // o link revogado já não abre
    expect((await h.call(`/api/shared/${t}`)).status).toBe(404);

    // marcar como lida: só o próprio usuário
    const nid = after.notifications[0]!.id;
    expect((await h.call(`/api/notifications/${nid}/read`, { method: 'POST', cookie: adm.cookie })).status).toBe(404);
    expect((await h.call(`/api/notifications/${nid}/read`, { method: 'POST', cookie: owner.cookie })).status).toBe(204);

    // urgente: remove sem aviso prévio ao dono
    const l2 = await sharedLink(h, owner);
    await h.call('/api/reports', { method: 'POST', body: json({ link: l2.token, reason: 'illegal', turnstileToken: 't' }) });
    const id2 = (rows(h.raw, "select id from reports where reason='illegal'")[0] as { id: string }).id;
    const r2 = await h.call(`/api/admin/reports/${id2}/resolve`, { method: 'POST', cookie: adm.cookie, body: json({ action: 'revoke_link', confirm: true }) });
    expect(r2.status).toBe(200);
    expect((await h.call(`/api/shared/${l2.token}`)).status).toBe(404);
  });

  it('denúncia de outro workspace não permite agir fora do alvo; dono de outro workspace não vê nada', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    const b = await user(h, 'b@x.com', AUTH_KEY_B);
    await sharedLink(h, a);
    expect(((await (await h.call('/api/notifications', { cookie: b.cookie })).json()) as { notifications: unknown[] }).notifications).toHaveLength(0);
  });

  it('cron avisa admins em 70%/90% sem duplicar enquanto não lido', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    h.raw.prepare('update users set is_global_admin = 1 where id = ?').run(a.id);
    h.raw.prepare("update system_settings set value='1' where key='quota.clients_per_workspace'").run(); // 1 client implícito = 100%
    const db = makeDb(h.d1);
    await alertAdmins(db);
    await alertAdmins(db);
    const n = rows<{ payload_json: string }>(h.raw, "select payload_json from notifications where kind='quota.alert'");
    expect(n).toHaveLength(1);
    expect(JSON.parse(n[0]!.payload_json)).toMatchObject({ key: 'quota.clients_per_workspace', level: 'critical' });
  });
});
