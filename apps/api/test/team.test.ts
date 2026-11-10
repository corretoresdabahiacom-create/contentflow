import { describe, expect, it } from 'vitest';
import { AUTH_KEY_A, AUTH_KEY_B, json, register, rows, setup, type Harness } from './helpers';

type U = { cookie: string; id: string; personalWs: string };
async function user(h: Harness, email: string, key = AUTH_KEY_A): Promise<U> {
  const { cookie } = await register(h, email, key);
  const me = (await (await h.call('/api/auth/me', { cookie })).json()) as { user: { id: string }; workspaces: { id: string }[] };
  return { cookie, id: me.user.id, personalWs: me.workspaces[0]?.id as string };
}
const send = (h: Harness, u: U, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
  h.call(path, { method, cookie: u.cookie, body: body === undefined ? undefined : json(body) });
const j = async <T>(r: Response) => (await r.json()) as T;

/** Equipe com owner + membro(role) convidado por link. */
async function team(h: Harness, role: 'admin' | 'member' = 'member') {
  const owner = await user(h, `owner-${Math.random()}@x.com`);
  const guest = await user(h, `guest-${Math.random()}@x.com`, AUTH_KEY_B);
  const ws = await j<{ id: string }>(await send(h, owner, '/api/workspaces', { name: 'Agência' }));
  const inv = await j<{ token: string; id: string }>(await send(h, owner, `/api/workspaces/${ws.id}/invites`, { role }));
  const acc = await send(h, guest, `/api/invites/${inv.token}/accept`, {});
  expect(acc.status).toBe(200);
  return { owner, guest, ws: ws.id, inv };
}

describe('workspace de equipe e convites por link', () => {
  it('cria equipe (owner), recusa convite em workspace pessoal e respeita a cota de equipes', async () => {
    const h = setup();
    const a = await user(h, 'a@x.com');
    const personal = await send(h, a, `/api/workspaces/${a.personalWs}/invites`, { role: 'member' });
    expect(personal.status).toBe(409);
    for (let i = 0; i < 3; i++) expect((await send(h, a, '/api/workspaces', { name: `T${i}` })).status).toBe(201);
    expect((await send(h, a, '/api/workspaces', { name: 'T4' })).status).toBe(409);
  });

  it('convite: token só aparece uma vez, hash no banco, uso único, e vira membro', async () => {
    const h = setup();
    const t = await team(h);
    expect(rows<{ token_hash: string }>(h.raw, 'select token_hash from workspace_invites')[0]?.token_hash).not.toContain(t.inv.token);
    const again = await send(h, t.guest, `/api/invites/${t.inv.token}/accept`, {});
    expect(again.status).toBe(404); // já usado
    const third = await user(h, 'third@x.com');
    expect((await send(h, third, `/api/invites/${t.inv.token}`)).status).toBe(404);
    const members = await j<{ members: { role: string; email: string }[] }>(await send(h, t.guest, `/api/workspaces/${t.ws}/members`));
    expect(members.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
  });

  it('convite expirado, revogado ou inexistente: 404; sem login: 401', async () => {
    const h = setup();
    const owner = await user(h, 'o@x.com');
    const other = await user(h, 'p@x.com', AUTH_KEY_B);
    const ws = await j<{ id: string }>(await send(h, owner, '/api/workspaces', { name: 'A' }));
    const mk = async () => j<{ token: string; id: string }>(await send(h, owner, `/api/workspaces/${ws.id}/invites`, { role: 'member' }));
    const exp = await mk();
    h.raw.prepare('update workspace_invites set expires_at = ? where id = ?').run(Date.now() - 1000, exp.id);
    expect((await send(h, other, `/api/invites/${exp.token}/accept`, {})).status).toBe(404);
    const rev = await mk();
    expect((await send(h, owner, `/api/workspaces/${ws.id}/invites/${rev.id}`, undefined, 'DELETE')).status).toBe(200);
    expect((await send(h, other, `/api/invites/${rev.token}`)).status).toBe(404);
    expect((await send(h, other, '/api/invites/nao-existe')).status).toBe(404);
    expect((await h.call(`/api/invites/${rev.token}`)).status).toBe(401);
  });

  it('já membro não aceita de novo e o convite não é consumido; cota de membros vale no convite e no aceite', async () => {
    const h = setup();
    const owner = await user(h, 'o@x.com');
    const ws = await j<{ id: string }>(await send(h, owner, '/api/workspaces', { name: 'A' }));
    const inv = await j<{ token: string }>(await send(h, owner, `/api/workspaces/${ws.id}/invites`, { role: 'member' }));
    const self = await send(h, owner, `/api/invites/${inv.token}/accept`, {});
    expect(self.status).toBe(409);
    expect((await send(h, owner, `/api/invites/${inv.token}`)).status).toBe(200); // ainda válido
    h.raw.prepare("insert or replace into system_settings (key, value) values ('quota.members_per_workspace', '2')").run();
    expect((await send(h, owner, `/api/workspaces/${ws.id}/invites`, { role: 'member' })).status).toBe(409); // 1 membro + 1 convite = 2
  });

  it('papéis: só owner convida admin e muda papéis; membro não convida; owner não é removível; sair é permitido', async () => {
    const h = setup();
    const t = await team(h, 'admin');
    const adminInvitesAdmin = await send(h, t.guest, `/api/workspaces/${t.ws}/invites`, { role: 'admin' });
    expect(adminInvitesAdmin.status).toBe(403);
    expect((await send(h, t.guest, `/api/workspaces/${t.ws}/invites`, { role: 'member' })).status).toBe(201);
    const list = await j<{ members: { id: string; role: string; userId: string }[] }>(await send(h, t.owner, `/api/workspaces/${t.ws}/members`));
    const g = list.members.find((m) => m.userId === t.guest.id)!;
    const o = list.members.find((m) => m.role === 'owner')!;
    expect((await send(h, t.guest, `/api/workspaces/${t.ws}/members/${g.id}`, { role: 'member' }, 'PATCH')).status).toBe(403);
    expect((await send(h, t.owner, `/api/workspaces/${t.ws}/members/${o.id}`, { role: 'member' }, 'PATCH')).status).toBe(403);
    expect((await send(h, t.owner, `/api/workspaces/${t.ws}/members/${g.id}`, { role: 'member' }, 'PATCH')).status).toBe(200);
    expect((await send(h, t.guest, `/api/workspaces/${t.ws}/invites`, { role: 'member' })).status).toBe(403); // virou membro
    expect((await send(h, t.guest, `/api/workspaces/${t.ws}/members/${o.id}`, undefined, 'DELETE')).status).toBe(403);
    expect((await send(h, t.guest, `/api/workspaces/${t.ws}/members/${g.id}`, undefined, 'DELETE')).status).toBe(200); // sair
    expect((await send(h, t.guest, `/api/workspaces/${t.ws}/members`)).status).toBe(404); // já não enxerga
  });

  it('isolamento: quem não é membro recebe 404 em membros e convites', async () => {
    const h = setup();
    const t = await team(h);
    const stranger = await user(h, 's@x.com');
    expect((await send(h, stranger, `/api/workspaces/${t.ws}/members`)).status).toBe(404);
    expect((await send(h, stranger, `/api/workspaces/${t.ws}/invites`)).status).toBe(404);
    expect((await send(h, stranger, `/api/workspaces/${t.ws}/invites`, { role: 'member' })).status).toBe(404);
  });
});

// ---------- conteúdo para os testes de aprovação, calendário e compartilhamento ----------
async function content(h: Harness, owner: U, ws: string, clientName = 'Cliente') {
  const cl = await j<{ id: string }>(await send(h, owner, `/api/workspaces/${ws}/clients`, { name: clientName }));
  const pr = await j<{ id: string }>(await send(h, owner, `/api/workspaces/${ws}/clients/${cl.id}/projects`, { name: 'P' }));
  const base = `/api/workspaces/${ws}/clients/${cl.id}`;
  const proj = `${base}/projects/${pr.id}`;
  await send(h, owner, `${proj}/source`, { kind: 'paste', text: 'TEXTO FONTE SECRETO do projeto.' }, 'PUT');
  const o = await j<{ outputs: { id: string; version: number }[] }>(await send(h, owner, `${proj}/outputs`, { outputs: [{ channel: 'generic', kind: 'post', title: 'T1', body: 'Corpo um' }, { channel: 'generic', kind: 'post', title: 'T2', body: 'Corpo dois' }] }));
  return { client: cl.id, base, proj, out: o.outputs };
}

describe('aprovações', () => {
  it('pedir → decidir; só admin decide; separação de papéis na equipe; edição invalida a decisão', async () => {
    const h = setup();
    const t = await team(h, 'member');
    const c = await content(h, t.owner, t.ws);
    const out = c.out[0]!;
    const ask = await send(h, t.guest, `${c.proj}/outputs/${out.id}/approvals`, { note: 'por favor' });
    expect(ask.status).toBe(201);
    const { id } = await j<{ id: string }>(ask);
    expect((await send(h, t.guest, `${c.proj}/outputs/${out.id}/approvals`, {})).status).toBe(409); // já pendente
    const decide = (u: U, status: string) => send(h, u, `/api/workspaces/${t.ws}/approvals/${id}/decision`, { status });
    expect((await decide(t.guest, 'approved')).status).toBe(403); // membro não decide
    // edita o output depois do pedido: a decisão deixa de valer
    await send(h, t.owner, `${c.proj}/outputs/${out.id}`, { body: 'Corpo novo', version: out.version }, 'PATCH');
    expect((await decide(t.owner, 'approved')).status).toBe(409);
    const again = await send(h, t.guest, `${c.proj}/outputs/${out.id}/approvals`, {}); // substitui o pendente velho
    expect(again.status).toBe(201);
    const id2 = (await j<{ id: string }>(again)).id;
    expect((await send(h, t.owner, `/api/workspaces/${t.ws}/approvals/${id2}/decision`, { status: 'approved' })).status).toBe(200);
    expect((await send(h, t.owner, `/api/workspaces/${t.ws}/approvals/${id2}/decision`, { status: 'approved' })).status).toBe(409); // já decidido
    const latest = await j<{ approvals: { outputId: string; status: string; outputVersion: number }[] }>(await send(h, t.guest, `${c.proj}/approvals`));
    expect(latest.approvals.find((a) => a.outputId === out.id)).toMatchObject({ status: 'approved', outputVersion: 2 });
  });

  it('em equipe com 2+ admins o autor não aprova o próprio pedido; com um só admin pode; no pessoal o próprio usuário decide', async () => {
    const h = setup();
    const t = await team(h, 'admin');
    const c = await content(h, t.owner, t.ws);
    const ask = await j<{ id: string }>(await send(h, t.guest, `${c.proj}/outputs/${c.out[0]!.id}/approvals`, {}));
    expect((await send(h, t.guest, `/api/workspaces/${t.ws}/approvals/${ask.id}/decision`, { status: 'approved' })).status).toBe(403);
    expect((await send(h, t.owner, `/api/workspaces/${t.ws}/approvals/${ask.id}/decision`, { status: 'rejected', note: 'ajustar' })).status).toBe(200);
    // sozinho
    const solo = await user(h, 'solo@x.com');
    const sc = await content(h, solo, solo.personalWs);
    const a2 = await j<{ id: string }>(await send(h, solo, `${sc.proj}/outputs/${sc.out[0]!.id}/approvals`, {}));
    expect((await send(h, solo, `/api/workspaces/${solo.personalWs}/approvals/${a2.id}/decision`, { status: 'approved' })).status).toBe(200);
  });

  it('isolamento: outro workspace não vê nem decide', async () => {
    const h = setup();
    const t = await team(h);
    const c = await content(h, t.owner, t.ws);
    const a = await j<{ id: string }>(await send(h, t.owner, `${c.proj}/outputs/${c.out[0]!.id}/approvals`, {}));
    const stranger = await user(h, 's@x.com');
    expect((await send(h, stranger, `/api/workspaces/${t.ws}/approvals`)).status).toBe(404);
    expect((await send(h, stranger, `/api/workspaces/${t.ws}/approvals/${a.id}/decision`, { status: 'approved' })).status).toBe(404);
    expect((await send(h, stranger, `${c.proj}/outputs/${c.out[0]!.id}/approvals`, {})).status).toBe(404);
  });
});

describe('calendário editorial', () => {
  const DAY = Date.UTC(2026, 10, 15);
  it('CRUD com data sem fuso, status, responsável membro, versão e cota', async () => {
    const h = setup();
    const t = await team(h);
    const c = await content(h, t.owner, t.ws);
    expect((await send(h, t.guest, `${c.base}/calendar`, { title: 'x', scheduledFor: DAY + 1 })).status).toBe(400); // não é meia-noite UTC
    expect((await send(h, t.guest, `${c.base}/calendar`, { title: 'x', scheduledFor: DAY, status: 'viral' })).status).toBe(400);
    const stranger = await user(h, 'st@x.com');
    expect((await send(h, t.guest, `${c.base}/calendar`, { title: 'x', scheduledFor: DAY, assigneeUserId: stranger.id })).status).toBe(400);
    const ok = await send(h, t.guest, `${c.base}/calendar`, { title: 'Post', scheduledFor: DAY, assigneeUserId: t.guest.id, outputId: c.out[0]!.id });
    expect(ok.status).toBe(201);
    const { id } = await j<{ id: string }>(ok);
    const move = await send(h, t.owner, `${c.base}/calendar/${id}`, { scheduledFor: DAY + 86_400_000, status: 'review', version: 1 }, 'PATCH');
    expect(await j(move)).toMatchObject({ version: 2 });
    expect((await send(h, t.guest, `${c.base}/calendar/${id}`, { title: 'outro', version: 1 }, 'PATCH')).status).toBe(409);
    await send(h, t.owner, `${c.base}/calendar`, { title: 'Sem data' });
    const list = await j<{ entries: { title: string; scheduledFor: number | null; status: string }[] }>(await send(h, t.owner, `${c.base}/calendar?from=${DAY}&to=${DAY + 86_400_000 * 3}`));
    expect(list.entries.map((e) => e.title).sort()).toEqual(['Post', 'Sem data']);
    expect(list.entries.find((e) => e.title === 'Post')).toMatchObject({ status: 'review', scheduledFor: DAY + 86_400_000 });
    h.raw.prepare("insert or replace into system_settings (key, value) values ('quota.calendar_per_workspace', '2')").run();
    expect((await send(h, t.owner, `${c.base}/calendar`, { title: 'terceiro' })).status).toBe(409);
    expect((await send(h, t.owner, `${c.base}/calendar/${id}`, undefined, 'DELETE')).status).toBe(200);
  });

  it('remover o membro limpa o responsável nas pautas', async () => {
    const h = setup();
    const t = await team(h);
    const c = await content(h, t.owner, t.ws);
    const e = await j<{ id: string }>(await send(h, t.owner, `${c.base}/calendar`, { title: 'P', scheduledFor: DAY, assigneeUserId: t.guest.id }));
    const list = await j<{ members: { id: string; userId: string }[] }>(await send(h, t.owner, `/api/workspaces/${t.ws}/members`));
    await send(h, t.owner, `/api/workspaces/${t.ws}/members/${list.members.find((m) => m.userId === t.guest.id)!.id}`, undefined, 'DELETE');
    expect(rows<{ assignee_user_id: string | null }>(h.raw, 'select assignee_user_id from editorial_calendar where id = ?', e.id)[0]?.assignee_user_id).toBeNull();
  });

  it('isolamento entre clients e entre workspaces', async () => {
    const h = setup();
    const t = await team(h);
    const a = await content(h, t.owner, t.ws, 'A');
    const b = await content(h, t.owner, t.ws, 'B');
    const e = await j<{ id: string }>(await send(h, t.owner, `${a.base}/calendar`, { title: 'do A', scheduledFor: DAY }));
    expect((await send(h, t.owner, `${b.base}/calendar/${e.id}`, { title: 'invadido', version: 1 }, 'PATCH')).status).toBe(404);
    expect((await send(h, t.owner, `${b.base}/calendar/${e.id}`, undefined, 'DELETE')).status).toBe(404);
    expect((await j<{ entries: unknown[] }>(await send(h, t.owner, `${b.base}/calendar`))).entries).toHaveLength(0);
    expect((await send(h, t.owner, `${b.base}/calendar`, { title: 'x', outputId: a.out[0]!.id })).status).toBe(404); // output de outro client
    const stranger = await user(h, 's@x.com');
    expect((await send(h, stranger, `${a.base}/calendar`)).status).toBe(404);
  });
});

describe('brand kit', () => {
  it('upsert por client (admin), validações e leitura por membros', async () => {
    const h = setup();
    const t = await team(h);
    const c = await content(h, t.owner, t.ws);
    expect((await j<{ brandKit: unknown }>(await send(h, t.guest, `${c.base}/brand-kit`))).brandKit).toBeNull();
    const put = (u: U, b: object) => send(h, u, `${c.base}/brand-kit`, b, 'PUT');
    expect((await put(t.guest, { name: 'Marca' })).status).toBe(403);
    expect((await put(t.owner, { name: 'Marca', logoUrl: 'http://x.com/a.png' })).status).toBe(400);
    expect((await put(t.owner, { name: 'Marca', logoUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await put(t.owner, { name: 'Marca', primaryColor: 'azul' })).status).toBe(400);
    expect((await put(t.owner, { name: 'Marca', logoUrl: 'https://cdn.exemplo.com/l.png', primaryColor: '#AA00FF', tone: 'direto' })).status).toBe(200);
    expect((await put(t.owner, { name: 'Marca 2', primaryColor: '#112233' })).status).toBe(200);
    expect(rows(h.raw, 'select 1 from brand_kits').length).toBe(1);
    expect((await j<{ brandKit: { name: string; logoUrl: string | null } }>(await send(h, t.guest, `${c.base}/brand-kit`))).brandKit).toMatchObject({ name: 'Marca 2', logoUrl: null });
  });
});

describe('links compartilháveis', () => {
  it('expõe só os outputs escolhidos + brand kit; nada do texto-fonte; log com dedupe; revogar derruba', async () => {
    const h = setup();
    const t = await team(h);
    const c = await content(h, t.owner, t.ws);
    await send(h, t.owner, `${c.base}/brand-kit`, { name: 'Marca', primaryColor: '#112233' }, 'PUT');
    expect((await send(h, t.guest, `${c.base}/shared-links`, { outputIds: [c.out[0]!.id] })).status).toBe(403);
    const mk = await send(h, t.owner, `${c.base}/shared-links`, { outputIds: [c.out[0]!.id] });
    expect(mk.status).toBe(201);
    const link = await j<{ id: string; token: string; path: string }>(mk);
    expect(rows<{ token_hash: string }>(h.raw, 'select token_hash from shared_links')[0]?.token_hash).not.toContain(link.token);

    const pub = await h.call(`/api/shared/${link.token}`); // sem cookie
    expect(pub.status).toBe(200);
    expect(pub.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(pub.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await pub.text();
    expect(body).not.toContain('SECRETO');
    expect(body).not.toContain('Corpo dois');
    const data = JSON.parse(body) as { outputs: { title: string }[]; brandKit: { name: string } };
    expect(data.outputs.map((o) => o.title)).toEqual(['T1']);
    expect(data.brandKit.name).toBe('Marca');
    await h.call(`/api/shared/${link.token}`);
    expect(rows(h.raw, 'select 1 from shared_link_access_logs').length).toBe(1); // dedupe

    const listed = await j<{ links: { status: string; views: number; outputs: number }[] }>(await send(h, t.owner, `${c.base}/shared-links`));
    expect(listed.links[0]).toMatchObject({ status: 'active', views: 1, outputs: 1 });
    const logs = await j<{ logs: { visitor: string | null }[] }>(await send(h, t.owner, `${c.base}/shared-links/${link.id}/access-logs`));
    expect(logs.logs).toHaveLength(1);

    expect((await send(h, t.owner, `${c.base}/shared-links/${link.id}`, undefined, 'DELETE')).status).toBe(200);
    expect((await h.call(`/api/shared/${link.token}`)).status).toBe(404);
  });

  it('expirado e token inventado: 404; output de outro client: 404; cota de links', async () => {
    const h = setup();
    const t = await team(h);
    const a = await content(h, t.owner, t.ws, 'A');
    const b = await content(h, t.owner, t.ws, 'B');
    expect((await send(h, t.owner, `${a.base}/shared-links`, { outputIds: [b.out[0]!.id] })).status).toBe(404);
    expect((await send(h, t.owner, `${a.base}/shared-links`, { outputIds: [] })).status).toBe(400);
    expect((await send(h, t.owner, `${a.base}/shared-links`, { outputIds: [a.out[0]!.id], expiresInDays: 31 })).status).toBe(400);
    const link = await j<{ id: string; token: string }>(await send(h, t.owner, `${a.base}/shared-links`, { outputIds: [a.out[0]!.id] }));
    h.raw.prepare('update shared_links set expires_at = ? where id = ?').run(Date.now() - 1, link.id);
    expect((await h.call(`/api/shared/${link.token}`)).status).toBe(404);
    expect((await h.call('/api/shared/inventado')).status).toBe(404);
    h.raw.prepare("insert or replace into system_settings (key, value) values ('quota.shared_links_per_workspace', '1')").run();
    expect((await send(h, t.owner, `${a.base}/shared-links`, { outputIds: [a.out[0]!.id] })).status).toBe(201); // o expirado não conta
    expect((await send(h, t.owner, `${a.base}/shared-links`, { outputIds: [a.out[0]!.id] })).status).toBe(409);
  });

  it('isolamento: outro workspace e outro client não listam nem revogam; output apagado some do link', async () => {
    const h = setup();
    const t = await team(h);
    const a = await content(h, t.owner, t.ws, 'A');
    const b = await content(h, t.owner, t.ws, 'B');
    const link = await j<{ id: string; token: string }>(await send(h, t.owner, `${a.base}/shared-links`, { outputIds: [a.out[0]!.id, a.out[1]!.id] }));
    const stranger = await user(h, 's@x.com');
    expect((await send(h, stranger, `${a.base}/shared-links`)).status).toBe(404);
    expect((await send(h, t.owner, `${b.base}/shared-links/${link.id}`, undefined, 'DELETE')).status).toBe(404);
    expect((await send(h, t.owner, `${b.base}/shared-links/${link.id}/access-logs`)).status).toBe(404);
    await send(h, t.owner, `${a.proj}/outputs/${a.out[1]!.id}`, undefined, 'DELETE');
    const data = await j<{ outputs: unknown[] }>(await h.call(`/api/shared/${link.token}`));
    expect(data.outputs).toHaveLength(1);
  });
});
