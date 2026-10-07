/** Console diagnostics, prefixed so they are easy to filter ("LC Sync") in DevTools. */
export function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console -- intentional diagnostics
  console.info('%c[LC Sync]', 'color:#1f6feb;font-weight:600', ...args);
}

export function logError(...args: unknown[]): void {
  console.warn('[LC Sync]', ...args);
}
