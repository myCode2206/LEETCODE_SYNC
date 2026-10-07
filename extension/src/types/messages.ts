import type { GitHubAccessLevel, SyncProblemRequestInput, SyncResultDto } from '@lcsync/shared';
import type { QueueItem } from '../storage/queue-types.js';

/** Content script → background. */
export type ContentMessage =
  | { type: 'SUBMISSION_DETECTED'; request: SyncProblemRequestInput }
  | { type: 'DETECTION_FAILED'; submissionId: string; message: string };

/** Extension pages (popup/options) → background. */
export type UiMessage =
  | { type: 'CONNECT_GITHUB'; access: GitHubAccessLevel }
  | { type: 'CREATE_SIGN_IN_LINK'; access: GitHubAccessLevel }
  | { type: 'CANCEL_SIGN_IN_LINK' }
  | { type: 'DISCONNECT_GITHUB' }
  | { type: 'SIGN_OUT' }
  | { type: 'GET_QUEUE' }
  | { type: 'RETRY_QUEUE' }
  | { type: 'APPROVE_ITEM'; id: string }
  | { type: 'DISCARD_ITEM'; id: string };

export type ExtensionMessage = ContentMessage | UiMessage;

export interface LocalSyncRecord {
  id: string;
  title: string;
  at: string;
  result: SyncResultDto;
}

export interface QueueState {
  items: QueueItem[];
  recent: LocalSyncRecord[];
}

export type MessageResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
