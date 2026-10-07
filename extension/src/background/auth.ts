import type { GitHubAccessLevel, MeDto } from '@lcsync/shared';
import { ApiError } from '../services/api-client.js';
import type { ApiClient } from '../services/api-client.js';
import type { TypedStorage } from '../storage/storage.js';

const FRIENDLY_ERRORS: Record<string, string> = {
  access_denied: 'GitHub access was not granted. Click "Connect GitHub" to try again.',
  sign_in_failed: 'GitHub sign-in failed. Please try again.',
  github_error: 'GitHub reported an error during sign-in. Please try again.',
};

/**
 * Opens GitHub sign-in via the backend. The backend keeps the GitHub token; the extension only
 * receives a one-time code (in the chromiumapp.org redirect) that it exchanges for a session.
 */
export async function connectGitHub(
  api: ApiClient,
  storage: TypedStorage,
  access: GitHubAccessLevel,
): Promise<MeDto> {
  const redirectUri = chrome.identity.getRedirectURL('github');
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: api.loginUrl(redirectUri, access),
      interactive: true,
    });
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (/did not approve|closed|cancel/i.test(message)) {
      throw new ApiError('GITHUB_AUTH_FAILED', 'Sign-in was cancelled.', 0, false);
    }
    throw new ApiError(
      'NETWORK_ERROR',
      'Could not open GitHub sign-in. Is the sync server reachable?',
      0,
      true,
    );
  }
  const params = new URL(responseUrl ?? redirectUri).searchParams;
  const error = params.get('error');
  const code = params.get('code');
  if (error || !code) {
    throw new ApiError(
      'GITHUB_AUTH_FAILED',
      FRIENDLY_ERRORS[error ?? ''] ?? FRIENDLY_ERRORS.sign_in_failed!,
      0,
      false,
    );
  }
  const session = await api.exchangeCode(code);
  await storage.set('session', { token: session.sessionToken, expiresAt: session.expiresAt });
  await storage.set('me', session.me);
  return session.me;
}

export async function clearLocalSession(storage: TypedStorage): Promise<void> {
  await storage.set('session', null);
  await storage.set('me', null);
  await storage.set('cachedStats', null);
  await storage.set('cachedProblems', null);
}
