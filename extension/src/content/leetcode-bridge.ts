// Isolated-world content script: receives events from the page hook, confirms them with
// LeetCode's API and hands a complete sync request to the background worker.
import { mapLeetCodeStatus } from '@lcsync/shared';
import { assembleSubmission, slugFromPath } from '../leetcode/assembler.js';
import { createLeetCodeApi } from '../leetcode/graphql.js';
import { isHookMessage } from '../leetcode/protocol.js';
import { SubmissionTracker } from '../leetcode/submission-tracker.js';
import type { CheckEvent, SubmitEvent } from '../leetcode/protocol.js';
import { chromeStorage } from '../storage/storage.js';
import type { ContentMessage } from '../types/messages.js';

const tracker = new SubmissionTracker();
const api = createLeetCodeApi();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function send(message: ContentMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    /* extension reloaded; nothing to do */
  });
}

async function handle(submit: SubmitEvent | null, check: CheckEvent): Promise<void> {
  const accepted = mapLeetCodeStatus(check.statusCode, check.statusMessage) === 'accepted';
  if (!accepted && !(await chromeStorage().get('settings')).syncFailedSubmissions) return;
  try {
    const request = await assembleSubmission({
      submit,
      check,
      pageSlug: slugFromPath(location.pathname),
      api,
      sha256,
      now: () => new Date(),
    });
    send({ type: 'SUBMISSION_DETECTED', request });
  } catch (err) {
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

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== location.origin || !isHookMessage(event.data))
    return;
  const e = event.data.event;
  if (e.kind === 'submit') {
    tracker.onSubmit(e);
    return;
  }
  const pair = tracker.onCheck(e);
  if (pair) void handle(pair.submit, pair.check);
});
