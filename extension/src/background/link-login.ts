import type { GitHubAccessLevel, MeDto } from '@lcsync/shared';
import { ApiError } from '../services/api-client.js';
import type { ApiClient } from '../services/api-client.js';
import type { PendingLogin, TypedStorage } from '../storage/storage.js';
import { logError } from '../utils/log.js';

export const LINK_POLL_ALARM = 'lcsync-link-poll';
const POLL_INTERVAL_MS = 3_000;
const RETRY_INTERVAL_MS = 6_000;
/** Consecutive failed polls (network, server) before the link is given up. */
const MAX_FAILED_POLLS = 5;

export interface LinkLoginDeps {
  api: ApiClient;
  storage: TypedStorage;
  onConnected: (me: MeDto) => void;
}

let polling: Promise<void> | null = null;

/**
 * Sign-in through a link that can be opened in any browser or profile. The pending link lives in
 * storage so the popup can close and reopen, and the worker can restart (the alarm resumes
 * polling) without losing it.
 */
export async function createSignInLink(
  deps: LinkLoginDeps,
  access: GitHubAccessLevel,
): Promise<PendingLogin> {
  const link = await deps.api.createLoginLink(access);
  const pending: PendingLogin = { ...link, access, error: null };
  await deps.storage.set('pendingLogin', pending);
  // Wakes the worker to keep polling if Chrome stops it while the user is on GitHub.
  await chrome.alarms.create(LINK_POLL_ALARM, { periodInMinutes: 0.5 });
  void resumeSignInLink(deps);
  return pending;
}

export async function cancelSignInLink(storage: TypedStorage): Promise<void> {
  await storage.set('pendingLogin', null);
  await chrome.alarms.clear(LINK_POLL_ALARM);
}

/** Polls the pending link until it completes, fails or expires. Concurrent calls share one loop. */
export function resumeSignInLink(deps: LinkLoginDeps): Promise<void> {
  polling ??= pollUntilDone(deps).finally(() => {
    polling = null;
  });
  return polling;
}

async function pollUntilDone({ api, storage, onConnected }: LinkLoginDeps): Promise<void> {
  let failures = 0;
  try {
    // Bounded: stops on success, cancel, link expiry (15 min) or MAX_FAILED_POLLS errors in a row.
    for (;;) {
      const pending = await storage.get('pendingLogin');
      if (!pending || pending.error) return;
      // Small grace period: a link approved just before expiry can still be claimed.
      if (Date.now() > Date.parse(pending.expiresAt) + 30_000) {
        return await fail(storage, pending, 'The sign-in link expired. Create a new one.');
      }
      let wait = POLL_INTERVAL_MS;
      try {
        const res = await api.pollLoginLink(pending.pollToken);
        failures = 0;
        if (res.status === 'complete') {
          // The user may have cancelled or created another link meanwhile.
          if ((await storage.get('pendingLogin'))?.pollToken !== pending.pollToken) return;
          const { session } = res;
          await storage.set('session', {
            token: session.sessionToken,
            expiresAt: session.expiresAt,
          });
          await storage.set('me', session.me);
          await storage.set('pendingLogin', null);
          onConnected(session.me);
          return;
        }
      } catch (err) {
        const e = err instanceof ApiError ? err : null;
        if (e && !e.retryable && e.code !== 'NETWORK_ERROR') {
          return await fail(storage, pending, e.message);
        }
        failures++;
        if (failures >= MAX_FAILED_POLLS) {
          return await fail(
            storage,
            pending,
            `Could not reach the sync server after ${MAX_FAILED_POLLS} tries. Create a new link.`,
          );
        }
        logError(
          `sign-in link poll failed (${failures}/${MAX_FAILED_POLLS}):`,
          (err as Error).message,
        );
        wait = RETRY_INTERVAL_MS;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    const pending = await storage.get('pendingLogin');
    if (!pending || pending.error) await chrome.alarms.clear(LINK_POLL_ALARM);
  }
}

async function fail(storage: TypedStorage, pending: PendingLogin, message: string): Promise<void> {
  if ((await storage.get('pendingLogin'))?.pollToken !== pending.pollToken) return;
  await storage.set('pendingLogin', { ...pending, error: message });
}
