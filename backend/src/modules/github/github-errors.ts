import { AppError } from '../../common/app-error.js';

/** What the failing request was about; decides how a 404 is explained. */
export type GitHubErrorContext =
  | { kind: 'generic' }
  | { kind: 'repository'; fullName?: string }
  | { kind: 'branch'; fullName: string; branch: string };

export interface GitHubResponseInfo {
  status: number;
  headers: Headers;
  body: unknown;
}

function messageOf(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return '';
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 16) + ' UTC';
}

/** Translates a failed GitHub API response into a user-facing AppError. */
export function toGitHubError(res: GitHubResponseInfo, context: GitHubErrorContext): AppError {
  const { status, headers } = res;
  const ghMessage = messageOf(res.body);

  if (status === 401) {
    return new AppError(
      'GITHUB_AUTH_EXPIRED',
      'GitHub authorization has expired. Please reconnect GitHub.',
    );
  }

  const remaining = headers.get('x-ratelimit-remaining');
  const retryAfter = headers.get('retry-after');
  if ((status === 403 || status === 429) && (remaining === '0' || retryAfter)) {
    const reset = headers.get('x-ratelimit-reset');
    const retryAt = retryAfter
      ? new Date(Date.now() + Number(retryAfter) * 1000)
      : reset
        ? new Date(Number(reset) * 1000)
        : new Date(Date.now() + 60_000);
    return new AppError(
      'GITHUB_RATE_LIMITED',
      `GitHub rate limit reached. Sync will resume automatically after ${formatTime(retryAt)}.`,
      { retryAt },
    );
  }

  const repoName =
    context.kind === 'generic' ? 'the repository' : (context.fullName ?? 'the repository');

  if (status === 403) {
    return new AppError(
      'GITHUB_PERMISSION_DENIED',
      `GitHub denied access to ${repoName}. Make sure you have write access` +
        ' and that the app is allowed for this organization.',
    );
  }

  if (status === 404) {
    if (context.kind === 'branch') {
      return new AppError(
        'GITHUB_BRANCH_NOT_FOUND',
        `Branch "${context.branch}" does not exist in ${context.fullName}. Choose another branch in Settings.`,
      );
    }
    if (context.kind === 'repository') {
      return new AppError(
        'GITHUB_REPO_NOT_FOUND',
        `Repository ${repoName} was not found. It may have been deleted, renamed, or made private` +
          ' without private-repository access. Check Settings or reconnect GitHub.',
      );
    }
    return new AppError('NOT_FOUND', 'The requested GitHub resource was not found.');
  }

  if (status === 409 && /empty/i.test(ghMessage)) {
    return new AppError('GITHUB_CONFLICT', 'The repository is empty.', { status: 409 });
  }

  if (status === 422) {
    return new AppError(
      'VALIDATION_FAILED',
      `GitHub rejected the request: ${ghMessage || 'validation failed'}.`,
      {
        status: 422,
      },
    );
  }

  if (status >= 500) {
    return new AppError(
      'GITHUB_UNAVAILABLE',
      'GitHub is temporarily unavailable. Your solution is saved and will be retried.',
    );
  }

  return new AppError(
    'GITHUB_UNAVAILABLE',
    `Unexpected response from GitHub (${status}). Please try again.`,
    {
      status: 502,
    },
  );
}

export function networkError(cause: unknown): AppError {
  return new AppError(
    'GITHUB_UNAVAILABLE',
    'Could not reach GitHub. Your solution is saved and will be retried.',
    { cause },
  );
}
