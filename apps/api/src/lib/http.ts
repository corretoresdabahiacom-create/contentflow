import type { ErrorCode } from '@contentflow/shared';

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
    public code: ErrorCode | 'server_not_configured',
    message: string,
    public limitation?: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}
