import { mapLeetCodeStatus } from '@lcsync/shared';
import type { LeetCodeApi } from './graphql.js';
import type { CheckEvent } from './protocol.js';

export interface PollOptions {
  api: Pick<LeetCodeApi, 'fetchSubmissionDetails'>;
  /** True once the result was obtained another way (stop polling). */
  isHandled: (submissionId: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
  initialDelayMs?: number;
  /** Waits between checks; the number of entries + 1 is the number of checks (at most 5). */
  intervalsMs?: readonly number[];
}

/** 5 checks spread over ~50s: judging is usually done in seconds but can queue in contests. */
const DEFAULT_INTERVALS_MS = [3_000, 6_000, 12_000, 24_000];

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Backup result detection that does not depend on the format of LeetCode's polling endpoint:
 * after a submit, ask LeetCode's own submissionDetails API until it reports a final verdict.
 */
export async function pollForResult(
  submissionId: string,
  opts: PollOptions,
): Promise<CheckEvent | null> {
  const sleep = opts.sleep ?? defaultSleep;
  await sleep(opts.initialDelayMs ?? 4000);
  const intervals = opts.intervalsMs ?? DEFAULT_INTERVALS_MS;
  for (let i = 0; i <= intervals.length; i++) {
    if (opts.isHandled(submissionId)) return null;
    const details = await opts.api.fetchSubmissionDetails(submissionId).catch(() => null);
    if (details?.statusCode != null && mapLeetCodeStatus(details.statusCode) !== 'unknown') {
      return {
        kind: 'check',
        submissionId,
        statusCode: details.statusCode,
        statusMessage: null,
        lang: details.lang,
        questionId: details.questionId,
        runtime: null,
        memory: null,
        runtimeMs: null,
        finishedAt: details.timestamp ? details.timestamp * 1000 : null,
      };
    }
    if (i < intervals.length) await sleep(intervals[i]!);
  }
  return null;
}
