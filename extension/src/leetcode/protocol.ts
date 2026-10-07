/**
 * Everything specific to LeetCode's network protocol lives in this directory. If LeetCode
 * changes its API, update the URL patterns and parsers here; nothing else depends on them.
 */

/** POST https://leetcode.com/problems/<slug>/submit/ */
export const SUBMIT_URL = /^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/submit\/?(?:\?.*)?$/;
/**
 * GET https://leetcode.com/submissions/detail/<numeric id>/[v2/]check/
 * ("Run code" uses non-numeric "runcode_…" ids and is ignored).
 */
export const CHECK_URL =
  /^https:\/\/leetcode\.com\/submissions\/detail\/(\d+)\/(?:v\d+\/)?check\/?(?:\?.*)?$/;

export const MESSAGE_SOURCE = 'lcsync-page-hook';

/** Submission request + response observed by the page hook. */
export interface SubmitEvent {
  kind: 'submit';
  slug: string;
  submissionId: string;
  lang: string | null;
  questionId: string | null;
  code: string | null;
}

/** Final judge result observed by the page hook (only state === "SUCCESS"). */
export interface CheckEvent {
  kind: 'check';
  submissionId: string;
  statusCode: number | null;
  statusMessage: string | null;
  lang: string | null;
  questionId: string | null;
  runtime: string | null;
  memory: string | null;
  runtimeMs: number | null;
  finishedAt: number | null;
}

export type HookEvent = SubmitEvent | CheckEvent;

export interface HookMessage {
  source: typeof MESSAGE_SOURCE;
  event: HookEvent;
}

export function isHookMessage(data: unknown): data is HookMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === MESSAGE_SOURCE &&
    typeof (data as { event?: { kind?: unknown } }).event?.kind === 'string'
  );
}
