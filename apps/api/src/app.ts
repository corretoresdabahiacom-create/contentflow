import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { ERROR_CODES, CLIENT_KDF_ITERATIONS } from '@contentflow/shared';
import type { AppEnv, Deps } from './context';
import { makeDb } from './db/client';
import { featureFlags } from './db/schema';
import { HttpError } from './lib/http';
import { turnstileMode } from './lib/turnstile';
import { originGuard, securityHeaders } from './middleware';
import { authRoutes } from './routes/auth';
import { workspaceRoutes } from './routes/workspaces';

const notFoundBody = { error: { code: ERROR_CODES.NOT_FOUND, message: 'Not found.' } };

export function createApp(deps: Deps = { fetch: (...a) => fetch(...a) }) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('db', makeDb(c.env.DB));
    await next();
  });
  app.use('/api/*', securityHeaders);
  app.use('/api/*', originGuard);

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Estado real da configuração (R4): a UI mostra "não configurado" a partir daqui.
  app.get('/api/config', async (c) => {
    const flag = await c
      .get('db')
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, 'monetization_enabled'))
      .get();
    return c.json({
      turnstile: { mode: turnstileMode(c.env), siteKey: c.env.TURNSTILE_SITE_KEY ?? null },
      authConfigured: !!c.env.SESSION_PEPPER && c.env.SESSION_PEPPER.length >= 32,
      authKdfIterations: CLIENT_KDF_ITERATIONS,
      features: { monetization: flag?.enabled === 1 },
    });
  });

  app.route('/api/auth', authRoutes(deps));
  app.route('/api/workspaces', workspaceRoutes);

  // R7: nenhuma rota de cobrança existe.
  for (const p of ['/billing', '/billing/*', '/api/billing', '/api/billing/*']) {
    app.all(p, (c) => c.json(notFoundBody, 404));
  }

  app.notFound((c) => c.json(notFoundBody, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
      return c.json(
        { error: { code: err.code, message: err.message, limitation: err.limitation } },
        err.status,
      );
    }
    console.error('unhandled', err instanceof Error ? err.name : 'unknown'); // nunca logar corpo/segredos
    return c.json({ error: { code: 'internal_error', message: 'Internal error.' } }, 500);
  });

  return app;
}
