import { describe, expect, it } from 'vitest';
import { AUTH_KEY_A, AUTH_KEY_B, json, register, rows, setup, type Harness } from './helpers';

type Ids = { ws: string; client: string; project: string; cookie: string };

async function tenant(h: Harness, email: string, key: string): Promise<Ids> {
  const { cookie } = await register(h, email, key);
  const me = (await (await h.call('/api/auth/me', { cookie })).json()) as {
    user: { id: string };
    workspaces: { id: string }[];
  };
  const ws = me.workspaces[0]?.id as string;
  const client = rows<{ id: string }>(h.raw, 'select id from clients where workspace_id = ?', ws)[0]
    ?.id as string;
  const project = crypto.randomUUID();
  h.raw
    .prepare(
      'insert into projects (id, workspace_id, client_id, name, created_by) values (?,?,?,?,?)',
    )
    .run(project, ws, client, 'p', me.user.id);
  return { ws, client, project, cookie };
}

describe('isolamento multi-tenant (A tenta acessar B => 404)', () => {
  it('workspace, clients e projetos de outro tenant não são acessíveis', async () => {
    const h = setup();
    const a = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const b = await tenant(h, 'b@x.com', AUTH_KEY_B);

    // próprio acesso funciona em toda a cadeia
    for (const p of [
      `/api/workspaces/${a.ws}`,
      `/api/workspaces/${a.ws}/clients`,
      `/api/workspaces/${a.ws}/clients/${a.client}`,
      `/api/workspaces/${a.ws}/clients/${a.client}/projects/${a.project}`,
    ]) {
      expect((await h.call(p, { cookie: a.cookie })).status, p).toBe(200);
    }

    // A -> recursos de B
    for (const p of [
      `/api/workspaces/${b.ws}`,
      `/api/workspaces/${b.ws}/clients`,
      `/api/workspaces/${b.ws}/clients/${b.client}`,
      `/api/workspaces/${b.ws}/clients/${b.client}/projects/${b.project}`,
    ]) {
      expect((await h.call(p, { cookie: a.cookie })).status, p).toBe(404);
    }
    // PATCH de A no workspace de B também não vaza nem altera
    const patch = await h.call(`/api/workspaces/${b.ws}`, {
      method: 'PATCH',
      cookie: a.cookie,
      body: json({ name: 'hack' }),
    });
    expect(patch.status).toBe(404);
    expect(rows(h.raw, 'select name from workspaces where id = ?', b.ws)[0]).not.toEqual({
      name: 'hack',
    });
  });

  it('isolamento por client: client/projeto de outro workspace usado na URL do meu => 404', async () => {
    const h = setup();
    const a = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const b = await tenant(h, 'b@x.com', AUTH_KEY_B);
    // workspace meu + client alheio
    expect(
      (await h.call(`/api/workspaces/${a.ws}/clients/${b.client}`, { cookie: a.cookie })).status,
    ).toBe(404);
    // workspace e client meus + projeto alheio
    expect(
      (
        await h.call(`/api/workspaces/${a.ws}/clients/${a.client}/projects/${b.project}`, {
          cookie: a.cookie,
        })
      ).status,
    ).toBe(404);
  });

  it('projeto do mesmo workspace mas de outro client não é acessível pela URL do primeiro client', async () => {
    const h = setup();
    const a = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const otherClient = crypto.randomUUID();
    h.raw
      .prepare('insert into clients (id, workspace_id, name) values (?,?,?)')
      .run(otherClient, a.ws, 'Cliente 2');
    const uid = rows<{ id: string }>(h.raw, 'select id from users')[0]?.id as string;
    const otherProject = crypto.randomUUID();
    h.raw
      .prepare(
        'insert into projects (id, workspace_id, client_id, name, created_by) values (?,?,?,?,?)',
      )
      .run(otherProject, a.ws, otherClient, 'p2', uid);
    expect(
      (
        await h.call(`/api/workspaces/${a.ws}/clients/${a.client}/projects/${otherProject}`, {
          cookie: a.cookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.call(`/api/workspaces/${a.ws}/clients/${otherClient}/projects/${otherProject}`, {
          cookie: a.cookie,
        })
      ).status,
    ).toBe(200);
  });

  it('sem sessão => 401 em toda a árvore', async () => {
    const h = setup();
    const a = await tenant(h, 'a@x.com', AUTH_KEY_A);
    expect((await h.call(`/api/workspaces/${a.ws}`)).status).toBe(401);
    expect((await h.call(`/api/workspaces/${a.ws}/clients`)).status).toBe(401);
  });
});

describe('requireRole', () => {
  it('member => 403, admin e owner => 200 ao renomear workspace', async () => {
    const h = setup();
    const owner = await tenant(h, 'a@x.com', AUTH_KEY_A);
    const other = await tenant(h, 'b@x.com', AUTH_KEY_B);
    const otherId = rows<{ id: string }>(h.raw, "select id from users where email='b@x.com'")[0]
      ?.id as string;
    const rename = (cookie: string, name: string) =>
      h.call(`/api/workspaces/${owner.ws}`, { method: 'PATCH', cookie, body: json({ name }) });

    // B é membro do workspace de A com papel member
    h.raw
      .prepare('insert into workspace_members (id, workspace_id, user_id, role) values (?,?,?,?)')
      .run(crypto.randomUUID(), owner.ws, otherId, 'member');
    expect((await h.call(`/api/workspaces/${owner.ws}`, { cookie: other.cookie })).status).toBe(
      200,
    );
    expect((await rename(other.cookie, 'novo')).status).toBe(403);

    h.raw
      .prepare("update workspace_members set role='admin' where user_id = ? and workspace_id = ?")
      .run(otherId, owner.ws);
    expect((await rename(other.cookie, 'por admin')).status).toBe(200);
    expect((await rename(owner.cookie, 'por owner')).status).toBe(200);
    expect(rows(h.raw, 'select name from workspaces where id = ?', owner.ws)).toEqual([
      { name: 'por owner' },
    ]);
    expect(rows(h.raw, "select 1 from audit_logs where action='workspace.rename'")).toHaveLength(2);
  });

  it('CHECK do banco rejeita papel inválido (FKs desligadas para isolar o CHECK)', () => {
    const h = setup();
    h.raw.exec('PRAGMA foreign_keys = OFF');
    expect(() =>
      h.raw
        .prepare('insert into workspace_members (id, workspace_id, user_id, role) values (?,?,?,?)')
        .run('x', 'w', 'u', 'god'),
    ).toThrow(/CHECK constraint failed/);
  });
});
