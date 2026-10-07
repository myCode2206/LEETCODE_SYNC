import { matchCheckUrl, matchSubmitUrl, parseCheck, parseSubmit } from './interceptor.js';
import { MESSAGE_SOURCE } from './protocol.js';
import type { HookEvent, HookMessage } from './protocol.js';

/**
 * Wraps fetch and XMLHttpRequest in the page context to observe LeetCode's submission
 * requests. It only reads clones of two endpoints' responses, never modifies requests or
 * responses, and any failure inside the observer is swallowed so the page is never affected.
 */
/** Keys and state of a JSON body (never values), for diagnosing format changes. */
function describeShape(body: string | null): string {
  try {
    const json = JSON.parse(body ?? '') as Record<string, unknown>;
    return `state=${String(json.state)} keys=${Object.keys(json).slice(0, 15).join(',')}`;
  } catch {
    return 'non-JSON response';
  }
}

export function installPageHook(
  win: Window & typeof globalThis,
  log: (...args: unknown[]) => void = () => {},
): void {
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
      if (slug) {
        const event = parseSubmit(slug, requestBody, responseBody);
        log(
          event
            ? `submit seen for "${slug}" (submission ${event.submissionId})`
            : `submit seen for "${slug}" but no submission id in response`,
          event ? '' : responseBody?.slice(0, 200),
        );
        return emit(event);
      }
      const id = matchCheckUrl(url);
      if (id) {
        const event = parseCheck(id, responseBody);
        if (event) log(`result for submission ${id}: ${event.statusMessage ?? event.statusCode}`);
        else log(`check ${id}: not final yet`, describeShape(responseBody));
        emit(event);
      }
    } catch {
      /* never break the page */
    }
  };

  const isInteresting = (url: string) =>
    matchSubmitUrl(url) !== null || matchCheckUrl(url) !== null;

  /**
   * Diagnostics: logs the method/path of submission-related requests (and GraphQL operation
   * names), never bodies or headers, so protocol changes on LeetCode's side are easy to spot.
   */
  const RELEVANT = /\/submit\/|\/check\/|graphql/i;
  const trace = (transport: string, method: string, url: string, body: unknown) => {
    try {
      if (!RELEVANT.test(url)) return;
      let operation = '';
      if (typeof body === 'string' && /graphql/i.test(url)) {
        operation = (JSON.parse(body) as { operationName?: string }).operationName ?? '';
      }
      // Of all GraphQL traffic, only submission-related operations are interesting.
      if (/graphql/i.test(url) && !/submission/i.test(operation)) return;
      log(
        `net ${transport} ${method.toUpperCase()} ${new URL(url).pathname}${operation ? ` (${operation})` : ''}`,
      );
    } catch {
      /* ignore */
    }
  };

  // ---- fetch
  const originalFetch = win.fetch.bind(win);
  win.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = absolute(input instanceof Request ? input.url : String(input));
    trace(
      'fetch',
      init?.method ?? (input instanceof Request ? input.method : 'GET'),
      url,
      init?.body,
    );
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

  // ---- WebSocket (diagnostics only: some judges push results over sockets)
  const NativeWebSocket = win.WebSocket;
  if (NativeWebSocket) {
    win.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args: [string | URL, (string | string[])?]) {
        try {
          log(`net websocket ${new URL(String(args[0])).host}${new URL(String(args[0])).pathname}`);
        } catch {
          /* ignore */
        }
        return Reflect.construct(target, args) as WebSocket;
      },
    });
  }

  // ---- XMLHttpRequest
  const XHR = win.XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;
  const urls = new WeakMap<XMLHttpRequest, string>();
  const methods = new WeakMap<XMLHttpRequest, string>();
  XHR.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    urls.set(this, absolute(String(url)));
    methods.set(this, method);
    return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.open;
  XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = urls.get(this);
    if (url) trace('xhr', methods.get(this) ?? 'GET', url, body);
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
