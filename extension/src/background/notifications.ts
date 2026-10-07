import type { Notice } from './sync-queue.js';

const PREFIX = 'lcsync:';

/** Shows a desktop notification; clicking it opens the commit (if any). */
export function showNotification(notice: Notice): void {
  const id = `${PREFIX}${Date.now()}:${notice.url ?? ''}`;
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: notice.title,
    message: notice.message,
    priority: notice.kind === 'error' ? 2 : 0,
  });
}

export function registerNotificationClicks(): void {
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(PREFIX)) return;
    const url = id.slice(id.indexOf(':', PREFIX.length) + 1);
    if (url.startsWith('https://github.com/')) void chrome.tabs.create({ url });
    chrome.notifications.clear(id);
  });
}
