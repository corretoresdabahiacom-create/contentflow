export interface Env {
  DB: D1Database;
  /** Segredo do servidor (wrangler secret). Sem ele, auth responde 503. */
  SESSION_PEPPER?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  /** 'development' habilita bypass explícito do Turnstile quando não há secret. */
  ENVIRONMENT?: string;
  /** Origens extras (separadas por vírgula) aceitas em requisições não idempotentes. */
  ALLOWED_ORIGINS?: string;
}
