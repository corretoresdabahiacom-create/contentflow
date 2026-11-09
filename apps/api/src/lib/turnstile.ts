import type { Env } from '../env';

export type TurnstileResult = 'ok' | 'failed' | 'not_configured';
export type TurnstileMode = 'enforced' | 'dev_bypass' | 'not_configured';

export const turnstileMode = (env: Env): TurnstileMode =>
  env.TURNSTILE_SECRET
    ? 'enforced'
    : env.ENVIRONMENT === 'development'
      ? 'dev_bypass'
      : 'not_configured';

/** Falha fechada: sem secret fora de desenvolvimento, nunca libera (docs/security.md). */
export async function verifyTurnstile(
  env: Env,
  token: string,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const mode = turnstileMode(env);
  if (mode === 'dev_bypass') return 'ok';
  if (mode === 'not_configured') return 'not_configured';
  try {
    const body = new FormData();
    body.set('secret', env.TURNSTILE_SECRET as string);
    body.set('response', token);
    if (ip) body.set('remoteip', ip);
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}
