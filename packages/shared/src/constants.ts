export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

export const SUPPORTED_LOCALES = ['en', 'pt'] as const; // estrutura pronta para 'es'
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Iterações do PBKDF2 executado no navegador (decisão de 2026-11-09, ver docs/security.md). */
export const CLIENT_KDF_ITERATIONS = 600_000;
export const AUTH_KEY_LENGTH = 43; // 32 bytes em base64url sem padding

export const ERROR_CODES = {
  VALIDATION: 'validation_error',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  INVALID_CREDENTIALS: 'invalid_credentials',
  EMAIL_TAKEN: 'email_taken',
  RATE_LIMITED: 'rate_limited',
  TURNSTILE_FAILED: 'turnstile_failed',
  TURNSTILE_NOT_CONFIGURED: 'turnstile_not_configured',
  ORIGIN_NOT_ALLOWED: 'origin_not_allowed',
  QUOTA_EXCEEDED: 'quota_exceeded',
  VERSION_CONFLICT: 'version_conflict',
  INVALID_STATE: 'invalid_state',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
