/** Stable error codes shared by backend responses and extension UI. */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'SYNC_IN_PROGRESS',
  'REPOSITORY_NOT_CONFIGURED',
  'INVALID_REPOSITORY_CONFIG',
  'GITHUB_NOT_CONNECTED',
  'GITHUB_AUTH_EXPIRED',
  'GITHUB_AUTH_FAILED',
  'GITHUB_PERMISSION_DENIED',
  'GITHUB_REPO_NOT_FOUND',
  'GITHUB_BRANCH_NOT_FOUND',
  'GITHUB_RATE_LIMITED',
  'GITHUB_UNAVAILABLE',
  'GITHUB_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Shape of every non-2xx JSON response from the backend. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    /** ISO timestamp after which a retry may succeed (rate limits). */
    retryAt?: string;
    details?: unknown;
  };
}

/** Errors where waiting and retrying the same request is expected to succeed. */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'SYNC_IN_PROGRESS',
  'GITHUB_RATE_LIMITED',
  'GITHUB_UNAVAILABLE',
  'GITHUB_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
]);

/** Errors that require the user to do something (reconnect, fix settings) before retrying. */
export const USER_ACTION_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'UNAUTHENTICATED',
  'GITHUB_NOT_CONNECTED',
  'GITHUB_AUTH_EXPIRED',
  'GITHUB_PERMISSION_DENIED',
  'GITHUB_REPO_NOT_FOUND',
  'GITHUB_BRANCH_NOT_FOUND',
  'REPOSITORY_NOT_CONFIGURED',
  'INVALID_REPOSITORY_CONFIG',
]);
