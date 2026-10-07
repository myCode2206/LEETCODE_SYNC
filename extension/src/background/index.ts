import { SyncProblemRequestSchema } from '@lcsync/shared';
import { API_BASE_URL, ApiClient, ApiError } from '../services/api-client.js';
import { log, logError } from '../utils/log.js';
import { chromeStorage } from '../storage/storage.js';
import type {
  ContentMessage,
  ExtensionMessage,
  MessageResponse,
  UiMessage,
} from '../types/messages.js';
import { clearLocalSession, connectGitHub } from './auth.js';
import {
  cancelSignInLink,
  createSignInLink,
  LINK_POLL_ALARM,
  resumeSignInLink,
} from './link-login.js';
import type { LinkLoginDeps } from './link-login.js';
import { registerNotificationClicks, showNotification } from './notifications.js';
import { SyncQueue } from './sync-queue.js';

const RETRY_ALARM = 'lcsync-retry';
const storage = chromeStorage();
const api = new ApiClient(async () => (await storage.get('session'))?.token ?? null);

const queue = new SyncQueue({
  storage,
  sync: async (request) => {
    log(`syncing ${request.idempotencyKey} to ${API_BASE_URL}`);
    try {
      const result = await api.syncProblem(request);
      log('server:', result.outcome, '—', result.message, result.commitUrl ?? '');
      return result;
    } catch (err) {
      logError('sync failed:', err instanceof ApiError ? `${err.code}: ${err.message}` : err);
      throw err;
    }
  },
  now: () => Date.now(),
  notify: (notice) => {
    void storage.get('settings').then((s) => {
      if (s.notifications || notice.kind === 'error') showNotification(notice);
    });
  },
  scheduleWake: (at) => {
    if (at === null) void chrome.alarms.clear(RETRY_ALARM);
    // Chrome enforces a 30s minimum for alarms.
    else void chrome.alarms.create(RETRY_ALARM, { when: Math.max(at, Date.now() + 30_000) });
  },
  onChange: (items) => {
    const count = items.length;
    void chrome.action.setBadgeText({ text: count ? String(count) : '' });
    void chrome.action.setBadgeBackgroundColor({
      color: items.some((i) => i.state === 'needs_attention') ? '#d93025' : '#5f6368',
    });
  },
});

const linkLogin: LinkLoginDeps = {
  api,
  storage,
  onConnected: (me) => {
    showNotification({
      kind: 'success',
      title: 'GitHub connected',
      message: `Signed in as ${me.github?.login ?? 'your GitHub account'}.`,
    });
    void queue.retryAll();
  },
};

async function handleContent(msg: ContentMessage): Promise<unknown> {
  switch (msg.type) {
    case 'SUBMISSION_DETECTED': {
      log(
        'submission received from LeetCode tab:',
        msg.request.idempotencyKey,
        msg.request.submission.status,
      );
      const parsed = SyncProblemRequestSchema.safeParse(msg.request);
      if (!parsed.success)
        throw new ApiError('VALIDATION_FAILED', 'Detected submission was incomplete.', 0, false);
      const settings = await storage.get('settings');
      const accepted = msg.request.submission.status === 'accepted';
      if (!accepted && !settings.syncFailedSubmissions) return 'ignored';
      if (!(await storage.get('session')))
        logError('not signed in: open the extension and click Connect GitHub');
      const request = { ...msg.request, options: { commit: settings.commitAutomatically } };
      return queue.enqueue(request, { hold: accepted && !settings.autoSync });
    }
    case 'DETECTION_FAILED':
      showNotification({
        kind: 'error',
        title: 'Could not read your submission',
        message: msg.message,
      });
      return null;
  }
}

async function handleUi(msg: UiMessage): Promise<unknown> {
  switch (msg.type) {
    case 'CONNECT_GITHUB': {
      const me = await connectGitHub(api, storage, msg.access);
      void queue.retryAll();
      return me;
    }
    case 'CREATE_SIGN_IN_LINK':
      return createSignInLink(linkLogin, msg.access);
    case 'CANCEL_SIGN_IN_LINK':
      await cancelSignInLink(storage);
      return null;
    case 'DISCONNECT_GITHUB':
      await api.disconnectGitHub().catch(() => undefined);
      await clearLocalSession(storage);
      return null;
    case 'SIGN_OUT':
      await api.logout().catch(() => undefined);
      await clearLocalSession(storage);
      return null;
    case 'GET_QUEUE':
      return queue.state();
    case 'RETRY_QUEUE':
      await queue.retryAll();
      return queue.state();
    case 'APPROVE_ITEM':
      await queue.approve(msg.id);
      return queue.state();
    case 'DISCARD_ITEM':
      await queue.discard(msg.id);
      return queue.state();
  }
}

const CONTENT_TYPES = new Set(['SUBMISSION_DETECTED', 'DETECTION_FAILED']);

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as ExtensionMessage;
  if (sender.id !== chrome.runtime.id || typeof msg?.type !== 'string') return false;

  let work: Promise<unknown>;
  if (CONTENT_TYPES.has(msg.type)) {
    // Content messages are only accepted from LeetCode tabs.
    if (!sender.tab || !sender.url?.startsWith('https://leetcode.com/')) return false;
    work = handleContent(msg as ContentMessage);
  } else {
    // UI messages are only accepted from the extension's own pages.
    if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    work = handleUi(msg as UiMessage);
  }
  work
    .then((data) => sendResponse({ ok: true, data } satisfies MessageResponse))
    .catch((err: unknown) => {
      const e =
        err instanceof ApiError
          ? err
          : new ApiError('INTERNAL', String((err as Error)?.message ?? err), 0, false);
      sendResponse({
        ok: false,
        error: { code: e.code, message: e.message },
      } satisfies MessageResponse);
    });
  return true; // async response
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void queue.process();
  if (alarm.name === LINK_POLL_ALARM) void resumeSignInLink(linkLogin);
});

chrome.runtime.onStartup.addListener(() => {
  void queue.process();
  void resumeSignInLink(linkLogin);
});
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
  void queue.process();
});

registerNotificationClicks();
