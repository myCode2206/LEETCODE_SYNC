// Isolated-world content script: receives events from the page hook, confirms them with
// LeetCode's API and hands a complete sync request to the background worker.
import { mapLeetCodeStatus } from '@lcsync/shared';
import { assembleSubmission, slugFromPath } from '../leetcode/assembler.js';
import { createLeetCodeApi } from '../leetcode/graphql.js';
import { isHookMessage } from '../leetcode/protocol.js';
import { pollForResult } from '../leetcode/result-poller.js';
import { SubmissionTracker } from '../leetcode/submission-tracker.js';
import type { CheckEvent, SubmitEvent } from '../leetcode/protocol.js';
import { chromeStorage } from '../storage/storage.js';
import type { ContentMessage } from '../types/messages.js';
import { log, logError } from '../utils/log.js';

const tracker = new SubmissionTracker();
const api = createLeetCodeApi();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function send(message: ContentMessage): void {
  chrome.runtime
    .sendMessage(message)
    .then((res: unknown) => log('extension replied:', res))
    .catch((err: unknown) =>
      logError(
        'could not reach the extension. Reload this tab after reloading the extension.',
        err,
      ),
    );
}

async function handle(submit: SubmitEvent | null, check: CheckEvent): Promise<void> {
  const accepted = mapLeetCodeStatus(check.statusCode, check.statusMessage) === 'accepted';
  log(
    `submission ${check.submissionId}: ${accepted ? 'Accepted' : (check.statusMessage ?? 'not accepted')}`,
  );
  if (!accepted && !(await chromeStorage().get('settings')).syncFailedSubmissions) {
    log('not accepted and "Sync failed submissions" is off: ignoring');
    return;
  }
  try {
    const request = await assembleSubmission({
      submit,
      check,
      pageSlug: slugFromPath(location.pathname),
      api,
      sha256,
      now: () => new Date(),
    });
    log(`sending "${request.problem.title}" (${request.submission.language}) to the extension`);
    send({ type: 'SUBMISSION_DETECTED', request });
  } catch (err) {
    logError('could not build the submission:', (err as Error).message);
    // Only report problems for accepted solutions; failed runs are not worth a notification.
    if (accepted) {
      send({
        type: 'DETECTION_FAILED',
        submissionId: check.submissionId,
        message: (err as Error).message,
      });
    }
  }
}

log('bridge ready');
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== location.origin || !isHookMessage(event.data))
    return;
  const e = event.data.event;
  if (e.kind === 'submit') {
    tracker.onSubmit(e);
    // Backup: if the result is not observed on the network, ask LeetCode's API for it.
    void pollForResult(e.submissionId, { api, isHandled: (id) => tracker.isHandled(id) }).then(
      (check) => {
        if (!check) return;
        log(`result for submission ${check.submissionId} obtained from LeetCode's API`);
        const pair = tracker.onCheck(check);
        if (pair) void handle(pair.submit, pair.check);
      },
    );
    return;
  }
  // A result we cannot interpret must not mark the submission as handled: the poller will.
  if (mapLeetCodeStatus(e.statusCode, e.statusMessage) === 'unknown') {
    log(
      `result for submission ${e.submissionId} has an unknown format; asking LeetCode's API instead`,
    );
    return;
  }
  const pair = tracker.onCheck(e);
  if (pair) void handle(pair.submit, pair.check);
});
