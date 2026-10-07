import { RETRYABLE_CODES } from '@lcsync/shared';
import type { ApiErrorBody, ErrorCode } from '@lcsync/shared';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SYNC_IN_PROGRESS: 409,
  REPOSITORY_NOT_CONFIGURED: 412,
  INVALID_REPOSITORY_CONFIG: 400,
  GITHUB_NOT_CONNECTED: 412,
  GITHUB_AUTH_EXPIRED: 401,
  GITHUB_AUTH_FAILED: 502,
  GITHUB_PERMISSION_DENIED: 403,
  GITHUB_REPO_NOT_FOUND: 404,
  GITHUB_BRANCH_NOT_FOUND: 404,
  GITHUB_RATE_LIMITED: 429,
  GITHUB_UNAVAILABLE: 503,
  GITHUB_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Application error with a stable code and a message that is safe to show to users. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAt: Date | undefined;
  readonly details: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; retryAt?: Date; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.retryAt = options.retryAt;
    this.details = options.details;
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.retryAt ? { retryAt: this.retryAt.toISOString() } : {}),
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found.`);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
