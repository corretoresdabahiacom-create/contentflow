import { describe, expect, it } from 'vitest';
import { json, register, rows, setup } from './helpers';

/** Revisão de segurança automatizada da Fase 7 (ver docs/security-review.md). */
describe('segurança: CSRF, headers, upload malicioso, injeção', () => {
  it('toda rota que muda estado recusa Origin ausente ou de terceiros (CSRF)', async () => {
    const h = setup();
    const { cookie } = await register(h, 'a@x.com');
    const targets: [string, string, object][] = [
      ['POST', '/api/reports', { link: 'x'.repeat(30), reason: 'spam', turnstileToken: 't' }],
      ['POST', '/api/workspaces', { name: 'N' }],
      ['PATCH', '/api/admin/flags/video_render_enabled', { enabled: true }],
      ['PATCH', '/api/admin/settings/quota.projects_per_workspace', { value: 5 }],
      ['POST', '/api/admin/jobs/x/cancel', {}],
      ['POST', '/api/notifications/x/read', {}],
      ['POST', '/api/invites/x/accept', {}],
      ['POST', '/api/auth/logout', {}],
    ];
    for (const [method, path, body] of targets) {
      for (const origin of [null, 'https://evil.example']) {
        const res = await h.call(path, { method, cookie, origin, body: json(body) });
        expect(res.status, `${method} ${path} origin=${origin}`).toBe(403);
      }
    }
  });

  it('respostas da API trazem nosniff, no-store e frame deny; rotas públicas, no-referrer', async () => {
    const h = setup();
    for (const p of ['/api/health', '/api/config', '/api/admin/overview', '/api/nao-existe']) {
      const r = await h.call(p);
      expect(r.headers.get('X-Content-Type-Options'), p).toBe('nosniff');
      expect(r.headers.get('Cache-Control'), p).toBe('no-store');
      expect(r.headers.get('X-Frame-Options'), p).toBe('DENY');
    }
    expect((await h.call('/api/shared/' + 'q'.repeat(43))).headers.get('Referrer-Policy')).toBe('no-referrer');
    expect((await h.call('/api/shared/' + 'q'.repeat(43))).headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it('upload malicioso: binário disfarçado de texto (NUL) e texto gigante são recusados; nada é gravado', async () => {
    const h = setup();
    const { cookie } = await register(h, 'a@x.com');
    const ws = (rows(h.raw, 'select id from workspaces')[0] as { id: string }).id;
    const cl = (rows(h.raw, 'select id from clients')[0] as { id: string }).id;
    const base = `/api/workspaces/${ws}/clients/${cl}`;
    const pid = ((await (await h.call(`${base}/projects`, { method: 'POST', cookie, body: json({ name: 'P' }) })).json()) as { id: string }).id;
    const put = (text: string, kind = 'upload') => h.call(`${base}/projects/${pid}/source`, { method: 'PUT', cookie, body: json({ kind, filename: 'a.txt', text }) });
    expect((await put('MZ\u0000\u0003\u0000\u0000\u0000 executável disfarçado')).status).toBe(400);
    expect((await put('x'.repeat(2_000_001))).status).toBe(400);
    expect((await put('ok', 'binario')).status).toBe(400);
    expect(rows(h.raw, 'select * from project_sources')).toHaveLength(0);
    const o = await h.call(`${base}/projects/${pid}/outputs`, { method: 'POST', cookie, body: json({ outputs: [{ kind: 'post', body: 'a\u0000b' }] }) });
    expect(o.status).toBe(400);
  });

  it('injeção: SQL e HTML em denúncias são guardados como texto inerte', async () => {
    const h = setup();
    const evil = `'); DROP TABLE users;-- <script>alert(1)</script>`;
    const res = await h.call('/api/reports', { method: 'POST', body: json({ link: 'x'.repeat(30), reason: 'other', details: evil, contact: evil, turnstileToken: 't' }) });
    expect(res.status).toBe(201);
    expect(rows<{ details: string }>(h.raw, 'select details from reports')[0]!.details).toBe(evil);
    expect(rows(h.raw, 'select count(*) n from users')[0]).toEqual({ n: 0 });
  });

  it('sessão suspensa e cookie adulterado não passam; senha/authKey nunca voltam em respostas', async () => {
    const h = setup();
    const { cookie } = await register(h, 'a@x.com');
    expect((await h.call('/api/auth/me', { cookie: cookie + 'x' })).status).toBe(401);
    const me = await (await h.call('/api/auth/me', { cookie })).text();
    expect(me).not.toMatch(/password|authKey|salt|hash/i);
  });
});
