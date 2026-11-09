import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { createTestD1 } from './d1-shim';

export const AUTH_KEY_A = 'a'.repeat(43);
export const AUTH_KEY_B = 'b'.repeat(43);
const ORIGIN = 'http://localhost';

export function setup(overrides: Partial<Env> = {}, fetchStub?: typeof fetch) {
  const { d1, raw } = createTestD1();
  const env: Env = {
    DB: d1,
    SESSION_PEPPER: 'test-pepper-'.padEnd(40, 'x'), // fixture de teste, não é segredo real
    ENVIRONMENT: 'development',
    ...overrides,
  };
  const app = createApp({ fetch: fetchStub ?? (async () => new Response('{}')) });
  const call = (
    path: string,
    init: RequestInit & { cookie?: string; origin?: string | null } = {},
  ) => {
    const headers = new Headers(init.headers);
    if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
    if (init.cookie) headers.set('Cookie', init.cookie);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(`${ORIGIN}${path}`, { ...init, headers }, env);
  };
  return { call, raw, env, d1 };
}
export type Harness = ReturnType<typeof setup>;

export const json = (v: unknown) => JSON.stringify(v);

export const registerBody = (email: string, authKey = AUTH_KEY_A, extra: object = {}) =>
  json({ email, authKey, turnstileToken: 'tok', locale: 'pt', ...extra });

export const cookieOf = (res: Response): string => {
  const sc = res.headers.get('set-cookie') ?? '';
  return sc.split(';')[0] ?? '';
};

export async function register(h: Harness, email: string, authKey = AUTH_KEY_A) {
  const res = await h.call('/api/auth/register', {
    method: 'POST',
    body: registerBody(email, authKey),
  });
  return { res, cookie: cookieOf(res) };
}

export const rows = <T = Record<string, unknown>>(
  raw: DatabaseSync,
  sql: string,
  ...p: (string | number)[]
) => raw.prepare(sql).all(...p) as T[];
