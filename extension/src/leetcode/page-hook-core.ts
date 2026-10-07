import { matchCheckUrl, matchSubmitUrl, parseCheck, parseSubmit } from './interceptor.js';
import { MESSAGE_SOURCE } from './protocol.js';
import type { HookEvent, HookMessage } from './protocol.js';

/**
 * Wraps fetch and XMLHttpRequest in the page context to observe LeetCode's submission
 * requests. It only reads clones of two endpoints' responses, never modifies requests or
 * responses, and any failure inside the observer is swallowed so the page is never affected.
 */
export function installPageHook(win: Window & typeof globalThis): void {
  const marker = '__lcsyncHookInstalled';
  const flags = win as unknown as Record<string, boolean>;
  if (flags[marker]) return;
  flags[marker] = true;

  const emit = (event: HookEvent | null) => {
    if (!event) return;
    const message: HookMessage = { source: MESSAGE_SOURCE, event };
    win.postMessage(message, win.location.origin);
  };

  const absolute = (url: string) => {
    try {
      return new URL(url, win.location.href).toString();
    } catch {
      return url;
    }
  };

  const observe = (url: string, requestBody: string | null, responseBody: string | null) => {
    try {
      const slug = matchSubmitUrl(url);
      if (slug) return emit(parseSubmit(slug, requestBody, responseBody));
      const id = matchCheckUrl(url);
      if (id) emit(parseCheck(id, responseBody));
    } catch {
      /* never break the page */
    }
  };

  const isInteresting = (url: string) =>
    matchSubmitUrl(url) !== null || matchCheckUrl(url) !== null;

  // ---- fetch
  const originalFetch = win.fetch.bind(win);
  win.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = absolute(input instanceof Request ? input.url : String(input));
    if (!isInteresting(url)) return originalFetch(input, init);

    let requestBody: Promise<string | null> = Promise.resolve(
      typeof init?.body === 'string' ? init.body : null,
    );
    if (input instanceof Request && init?.body === undefined) {
      requestBody = input
        .clone()
        .text()
        .catch(() => null);
    }
    const response = await originalFetch(input, init);
    void Promise.all([
      requestBody,
      response
        .clone()
        .text()
        .catch(() => null),
    ]).then(([req, res]) => observe(url, req, res));
    return response;
  };

  // ---- XMLHttpRequest
  const XHR = win.XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;
  const urls = new WeakMap<XMLHttpRequest, string>();
  XHR.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    urls.set(this, absolute(String(url)));
    return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.open;
  XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = urls.get(this);
    if (url && isInteresting(url)) {
      this.addEventListener('load', () => {
        const text =
          this.responseType === '' || this.responseType === 'text' ? this.responseText : null;
        observe(url, typeof body === 'string' ? body : null, text);
      });
    }
    return send.call(this, body);
  };
}
