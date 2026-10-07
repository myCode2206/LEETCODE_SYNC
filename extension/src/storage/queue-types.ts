import type { SyncProblemRequestInput } from '@lcsync/shared';

export type QueueItemState =
  /** Waiting to be sent (possibly after a backoff delay). */
  | 'pending'
  /** Auto-sync is off: waiting for the user to approve. */
  | 'held'
  /** Cannot succeed until the user fixes something (reconnect, choose repository…). */
  | 'needs_attention';

export interface QueueItem {
  /** Idempotency key, e.g. "submission:123456". */
  id: string;
  title: string;
  status: string;
  request: SyncProblemRequestInput;
  state: QueueItemState;
  attempts: number;
  /** Epoch ms; the item is not retried before this time. */
  nextAttemptAt: number;
  lastError: { code: string; message: string } | null;
  createdAt: number;
}
