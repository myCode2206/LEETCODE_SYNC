import type { GitHubAccessLevel, MeDto } from '@lcsync/shared';
import { ApiError } from '../services/api-client.js';
import type { ApiClient } from '../services/api-client.js';
import type { TypedStorage } from '../storage/storage.js';
import { logError } from '../utils/log.js';

const FRIENDLY_ERRORS: Record<string, string> = {
  access_denied: 'GitHub access was not granted. Click "Connect GitHub" to try again.',
  sign_in_failed: 'GitHub sign-in failed. Please try again.',
  github_error: 'GitHub reported an error during sign-in. Please try again.',
};

/** A sign-in window left open this long is abandoned so the next click starts fresh. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

let inFlight: Promise<MeDto> | null = null;

/**
 * Opens GitHub sign-in via the backend. The backend keeps the GitHub token; the extension only
 * receives a one-time code (in the chromiumapp.org redirect) that it exchanges for a session.
 * Concurrent calls (e.g. a double click) share one sign-in window. Nothing from a failed attempt
 * is kept, so every new click starts from scratch.
 */
export function connectGitHub(
  api: ApiClient,
  storage: TypedStorage,
  access: GitHubAccessLevel,
): Promise<MeDto> {
  inFlight ??= withTimeout(runSignIn(api, storage, access), SIGN_IN_TIMEOUT_MS).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSignIn(
  api: ApiClient,
  storage: TypedStorage,
  access: GitHubAccessLevel,
): Promise<MeDto> {
  const redirectUri = chrome.identity.getRedirectURL('github');
  await preflight(api, redirectUri, access);
  const responseUrl = await openSignInWindow(api, redirectUri, access);

  const params = responseUrl?.startsWith(redirectUri)
    ? new URL(responseUrl).searchParams
    : new URLSearchParams();
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
  const session = await retryOnNetworkError(() => api.exchangeCode(code));
  await storage.set('session', { token: session.sessionToken, expiresAt: session.expiresAt });
  await storage.set('me', session.me);
  return session.me;
}

/**
 * Opens GitHub's sign-in window. A failure that is not the user cancelling is usually transient
 * (server restarting, slow network), so it is retried once after re-checking the server.
 */
async function openSignInWindow(
  api: ApiClient,
  redirectUri: string,
  access: GitHubAccessLevel,
): Promise<string | undefined> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await chrome.identity.launchWebAuthFlow({
        url: api.loginUrl(redirectUri, access),
        interactive: true,
      });
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (/did not approve|closed|cancel/i.test(message)) {
        throw new ApiError('GITHUB_AUTH_FAILED', 'Sign-in was cancelled.', 0, false);
      }
      logError(`launchWebAuthFlow failed (attempt ${attempt}):`, message);
      if (attempt < 2) {
        await delay(1_500);
        await preflight(api, redirectUri, access);
        continue;
      }
      // The server answered the pre-flight, so this is the GitHub leg (OAuth app config) or a
      // server error while starting the login.
      throw new ApiError(
        'GITHUB_AUTH_FAILED',
        'The GitHub sign-in page could not be loaded. Check the sync server logs and its ' +
          'GitHub OAuth app settings (client ID and callback URL), then try again.',
        0,
        true,
      );
    }
  }
}

/**
 * launchWebAuthFlow reports every failure as "Authorization page could not be loaded", so check
 * the server first and turn each failure into an actionable message.
 */
async function preflight(
  api: ApiClient,
  redirectUri: string,
  access: GitHubAccessLevel,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await api.checkLogin(redirectUri, access);
      return;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      // Older servers lack the check endpoint; let the real sign-in report any problem.
      if (err.status === 404) return;
      if (err.code === 'VALIDATION_FAILED') {
        throw new ApiError(
          'GITHUB_AUTH_FAILED',
          `The sync server does not accept this extension (ID ${chrome.runtime.id}). Add the ID ` +
            'to ALLOWED_EXTENSION_IDS in the server configuration and restart it.',
          err.status,
          false,
        );
      }
      if (err.code !== 'NETWORK_ERROR') throw err;
      if (attempt < 2) {
        await delay(1_000);
        continue;
      }
      logError('Sign-in pre-flight failed:', err.message);
      throw new ApiError(
        'NETWORK_ERROR',
        `Cannot reach the sync server at ${api.baseUrl}. Make sure it is running, then try again.`,
        0,
        true,
      );
    }
  }
}

async function retryOnNetworkError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'NETWORK_ERROR') throw err;
    await delay(1_000);
    return fn();
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new ApiError('GITHUB_AUTH_FAILED', 'Sign-in timed out. Please try again.', 0, true)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function clearLocalSession(storage: TypedStorage): Promise<void> {
  await storage.set('session', null);
  await storage.set('me', null);
  await storage.set('cachedStats', null);
  await storage.set('cachedProblems', null);
}
