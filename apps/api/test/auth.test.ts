import { describe, expect, it } from 'vitest';
import { cleanup } from '../src/jobs/cleanup';
import {
  AUTH_KEY_A,
  AUTH_KEY_B,
  cookieOf,
  json,
  register,
  registerBody,
  rows,
  setup,
} from './helpers';

describe('cadastro', () => {
  it('cria usuário, workspace pessoal, membership owner e client implícito', async () => {
    const h = setup();
    const { res } = await register(h, 'Ana@Example.com');
    expect(res.status).toBe(201);
    expect(rows(h.raw, 'select email from users')).toEqual([{ email: 'ana@example.com' }]);
    const ws = rows<{ kind: string; name: string }>(h.raw, 'select kind, name from workspaces');
    expect(ws).toHaveLength(1);
    expect(ws[0]?.kind).toBe('personal');
    expect(rows(h.raw, 'select role from workspace_members')).toEqual([{ role: 'owner' }]);
    expect(rows(h.raw, 'select name, is_implicit from clients')).toEqual([
      { name: 'Eu', is_implicit: 1 },
    ]);
    expect(rows(h.raw, "select action from audit_logs where action='auth.register'")).toHaveLength(
      1,
    );
  });

  it('cookie de sessão: __Host-, HttpOnly, Secure, SameSite=Lax, sem token em claro no banco', async () => {
    const h = setup();
    const { res, cookie } = await register(h, 'a@x.com');
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toMatch(/^__Host-cf_session=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//);
    const token = cookie.split('=')[1] as string;
    expect(JSON.stringify(rows(h.raw, 'select * from sessions'))).not.toContain(token);
  });

  it('a chave de autenticação nunca é armazenada em claro', async () => {
    const h = setup();
    await register(h, 'a@x.com');
    const u = rows<{ password_hash: string }>(h.raw, 'select password_hash from users')[0];
    expect(u?.password_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(u?.password_hash).not.toContain(AUTH_KEY_A);
  });

  it('rejeita e-mail duplicado (409) e corpo inválido (400)', async () => {
    const h = setup();
    await register(h, 'a@x.com');
    expect((await register(h, 'A@x.com')).res.status).toBe(409);
    const bad = await h.call('/api/auth/register', { method: 'POST', body: json({ email: 'x' }) });
    expect(bad.status).toBe(400);
  });

  it('CSRF: sem Origin ou com Origin externo => 403', async () => {
    const h = setup();
    const body = registerBody('a@x.com');
    expect(
      (await h.call('/api/auth/register', { method: 'POST', body, origin: null })).status,
    ).toBe(403);
    expect(
      (await h.call('/api/auth/register', { method: 'POST', body, origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(rows(h.raw, 'select 1 from users')).toHaveLength(0);
  });

  it('sem SESSION_PEPPER a autenticação responde 503 (nunca "funciona" sem segredo)', async () => {
    const h = setup({ SESSION_PEPPER: undefined });
    const res = await h.call('/api/auth/register', {
      method: 'POST',
      body: registerBody('a@x.com'),
    });
    expect(res.status).toBe(503);
  });
});

describe('Turnstile (falha fechada)', () => {
  it('sem secret fora de desenvolvimento => 503 turnstile_not_configured', async () => {
    const h = setup({ ENVIRONMENT: 'production', TURNSTILE_SECRET: undefined });
    const res = await h.call('/api/auth/register', {
      method: 'POST',
      body: registerBody('a@x.com'),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'turnstile_not_configured',
    );
    expect(rows(h.raw, 'select 1 from users')).toHaveLength(0);
  });

  it('com secret: verificação negativa bloqueia, positiva libera', async () => {
    const deny = setup(
      { ENVIRONMENT: 'production', TURNSTILE_SECRET: 'fixture-secret' },
      (async () => new Response(json({ success: false }))) as typeof fetch,
    );
    expect((await register(deny, 'a@x.com')).res.status).toBe(403);

    const allow = setup(
      { ENVIRONMENT: 'production', TURNSTILE_SECRET: 'fixture-secret' },
      (async () => new Response(json({ success: true }))) as typeof fetch,
    );
    expect((await register(allow, 'a@x.com')).res.status).toBe(201);
  });

  it('erro de rede na verificação => bloqueia (nunca libera)', async () => {
    const h = setup(
      { ENVIRONMENT: 'production', TURNSTILE_SECRET: 'fixture-secret' },
      (async () => {
        throw new Error('network');
      }) as typeof fetch,
    );
    expect((await register(h, 'a@x.com')).res.status).toBe(403);
  });

  it('/api/config reflete o estado real', async () => {
    const h = setup({ ENVIRONMENT: 'production', TURNSTILE_SECRET: undefined });
    const cfg = (await (await h.call('/api/config')).json()) as {
      turnstile: { mode: string };
      features: { monetization: boolean };
    };
    expect(cfg.turnstile.mode).toBe('not_configured');
    expect(cfg.features.monetization).toBe(false);
  });
});

describe('login / sessão / logout', () => {
  const login = (h: ReturnType<typeof setup>, email: string, authKey: string) =>
    h.call('/api/auth/login', {
      method: 'POST',
      body: json({ email, authKey, turnstileToken: 't' }),
    });

  it('login correto cria sessão; senha errada e usuário inexistente dão a mesma resposta', async () => {
    const h = setup();
    await register(h, 'a@x.com');
    const ok = await login(h, 'a@x.com', AUTH_KEY_A);
    expect(ok.status).toBe(200);
    expect(cookieOf(ok)).toMatch(/^__Host-cf_session=/);
    const wrong = await login(h, 'a@x.com', AUTH_KEY_B);
    const ghost = await login(h, 'ghost@x.com', AUTH_KEY_A);
    expect(wrong.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect(await wrong.json()).toEqual(await ghost.json());
    expect(rows(h.raw, "select 1 from audit_logs where action='auth.login_failed'")).toHaveLength(
      2,
    );
  });

  it('rate limit de login => 429 com Retry-After', async () => {
    const h = setup();
    await register(h, 'a@x.com');
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) last = await login(h, 'a@x.com', AUTH_KEY_B);
    expect(last?.status).toBe(429);
    expect(last?.headers.get('Retry-After')).toBeTruthy();
  });

  it('/api/auth/me exige sessão e lista workspaces', async () => {
    const h = setup();
    expect((await h.call('/api/auth/me')).status).toBe(401);
    const { cookie } = await register(h, 'a@x.com');
    const me = (await (await h.call('/api/auth/me', { cookie })).json()) as {
      user: { email: string };
      workspaces: { kind: string; role: string }[];
    };
    expect(me.user.email).toBe('a@x.com');
    expect(me.workspaces).toEqual([expect.objectContaining({ kind: 'personal', role: 'owner' })]);
  });

  it('logout invalida a sessão', async () => {
    const h = setup();
    const { cookie } = await register(h, 'a@x.com');
    expect((await h.call('/api/auth/logout', { method: 'POST', cookie })).status).toBe(204);
    expect((await h.call('/api/auth/me', { cookie })).status).toBe(401);
    expect(rows(h.raw, 'select 1 from sessions')).toHaveLength(0);
  });

  it('sessão expirada => 401', async () => {
    const h = setup();
    const { cookie } = await register(h, 'a@x.com');
    h.raw.exec('update sessions set expires_at = 1');
    expect((await h.call('/api/auth/me', { cookie })).status).toBe(401);
  });

  it('rotação: novo token após o prazo; o antigo vale 60 s e depois morre', async () => {
    const h = setup();
    const { cookie: oldCookie } = await register(h, 'a@x.com');
    h.raw.exec(`update sessions set rotated_at = ${Date.now() - 2 * 86_400_000}`);
    const res = await h.call('/api/auth/me', { cookie: oldCookie });
    expect(res.status).toBe(200);
    const newCookie = cookieOf(res);
    expect(newCookie).toMatch(/^__Host-cf_session=/);
    expect(newCookie).not.toBe(oldCookie);
    expect((await h.call('/api/auth/me', { cookie: newCookie })).status).toBe(200);
    expect((await h.call('/api/auth/me', { cookie: oldCookie })).status).toBe(200); // carência
    h.raw.exec(`update sessions set prev_valid_until = ${Date.now() - 1}`);
    expect((await h.call('/api/auth/me', { cookie: oldCookie })).status).toBe(401);
  });

  it('cleanup (cron) remove sessões expiradas e contadores antigos', async () => {
    const h = setup();
    await register(h, 'a@x.com');
    h.raw.exec('update sessions set expires_at = 1');
    h.raw.exec("insert into rate_limit_counters (key, window_start, count) values ('k', 1, 3)");
    await cleanup(h.d1);
    expect(rows(h.raw, 'select 1 from sessions')).toHaveLength(0);
    expect(rows(h.raw, "select 1 from rate_limit_counters where key='k'")).toHaveLength(0);
  });
});

describe('R7: sem monetização', () => {
  it('/billing/* e /api/billing/* retornam 404', async () => {
    const h = setup();
    for (const p of ['/billing', '/billing/checkout', '/api/billing', '/api/billing/portal']) {
      expect((await h.call(p)).status).toBe(404);
    }
  });
  it('feature_flag monetization_enabled = false no seed', () => {
    const h = setup();
    expect(
      rows(h.raw, "select enabled from feature_flags where key='monetization_enabled'"),
    ).toEqual([{ enabled: 0 }]);
  });
});
