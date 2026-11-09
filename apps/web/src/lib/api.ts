import type { ApiError } from '@contentflow/shared';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public limitation?: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...rest,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'network');
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (ApiError & T) | null;
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      body?.error?.code ?? 'internal_error',
      body?.error?.message ?? res.statusText,
      body?.error?.limitation,
    );
  }
  return body as T;
}

export type ServerConfig = {
  turnstile: { mode: 'enforced' | 'dev_bypass' | 'not_configured'; siteKey: string | null };
  authConfigured: boolean;
  authKdfIterations: number;
  features: { monetization: boolean };
};
