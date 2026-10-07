import { STATUS_LABELS, USER_ACTION_CODES } from '@lcsync/shared';
import type {
  ErrorCode,
  SubmissionStatus,
  SyncProblemRequestInput,
  SyncResultDto,
} from '@lcsync/shared';
import { ApiError } from '../services/api-client.js';
import type { QueueItem } from '../storage/queue-types.js';
import type { TypedStorage } from '../storage/storage.js';
import type { LocalSyncRecord, QueueState } from '../types/messages.js';

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 30 * 60_000;
const MAX_SEEN = 500;
const MAX_RECENT = 20;
/** Automatic tries per item; after that it waits for the user to press Retry. */
export const MAX_ATTEMPTS = 5;

export interface Notice {
  kind: 'success' | 'info' | 'error';
  title: string;
  message: string;
  url?: string | null;
}

export interface QueueDeps {
  storage: TypedStorage;
  sync: (request: SyncProblemRequestInput) => Promise<SyncResultDto>;
  now: () => number;
  notify: (notice: Notice) => void;
  /** Ask to be woken at `atMs` (null = nothing scheduled). */
  scheduleWake: (atMs: number | null) => void;
  onChange?: (items: QueueItem[]) => void;
}

/** Exponential backoff: 30s, 1m, 2m, 4m … capped at 30 minutes. */
export function backoffDelay(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

/**
 * Persistent queue of detected submissions. Items are written to storage *before* any network
 * call and removed only after the backend confirms, so nothing is lost if GitHub, the backend
 * or the network is down, or the service worker is stopped mid-sync. Every request carries an
 * idempotency key, so retrying is always safe.
 */
export class SyncQueue {
  private running: Promise<void> | null = null;
  /** All read-modify-write cycles on storage run one at a time (no lost updates). */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: QueueDeps) {}

  async enqueue(
    request: SyncProblemRequestInput,
    opts: { hold: boolean },
  ): Promise<'queued' | 'duplicate'> {
    const id = request.idempotencyKey;
    const fresh = await this.serial(async () => {
      const seen = await this.deps.storage.get('seenSubmissions');
      if (seen.includes(id)) return false;
      await this.deps.storage.set('seenSubmissions', [...seen, id].slice(-MAX_SEEN));
      return true;
    });
    if (!fresh) return 'duplicate';

    const status = request.submission.status as SubmissionStatus;
    const item: QueueItem = {
      id,
      title: `${request.problem.frontendId}. ${request.problem.title}`,
      status: STATUS_LABELS[status] ?? status,
      request,
      state: opts.hold ? 'held' : 'pending',
      attempts: 0,
      nextAttemptAt: this.deps.now(),
      lastError: null,
      createdAt: this.deps.now(),
    };
    await this.write((items) => (items.some((i) => i.id === id) ? items : [...items, item]));
    if (!opts.hold) void this.process();
    return 'queued';
  }

  /** Sends every due item. Concurrent calls share one run. */
  process(): Promise<void> {
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    const due = (await this.deps.storage.get('syncQueue'))
      .filter((i) => i.state === 'pending' && i.nextAttemptAt <= this.deps.now())
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const item of due) {
      try {
        const result = await this.deps.sync(item.request);
        await this.write((items) => items.filter((i) => i.id !== item.id));
        await this.record(item, result);
        this.announce(item, result);
      } catch (err) {
        const stop = await this.handleFailure(item, err);
        if (stop) break;
      }
    }
    await this.reschedule();
  }

  /** Returns true when further items would fail the same way (stop this run). */
  private async handleFailure(item: QueueItem, err: unknown): Promise<boolean> {
    const e =
      err instanceof ApiError
        ? err
        : new ApiError('INTERNAL', (err as Error)?.message ?? 'Unexpected error', 0, true);
    const error = { code: e.code, message: e.message };

    if (USER_ACTION_CODES.has(e.code as ErrorCode)) {
      // Affects every item (auth, repository): park all of them until the user fixes it.
      await this.write((items) =>
        items.map((i) =>
          i.state === 'pending' ? { ...i, state: 'needs_attention', lastError: error } : i,
        ),
      );
      this.deps.notify({ kind: 'error', title: 'Sync paused', message: e.message });
      return true;
    }

    if (!e.retryable) {
      await this.write((items) =>
        items.map((i) =>
          i.id === item.id ? { ...i, state: 'needs_attention', lastError: error } : i,
        ),
      );
      this.deps.notify({
        kind: 'error',
        title: `Could not sync ${item.title}`,
        message: e.message,
      });
      return false;
    }

    const attempts = item.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.write((items) =>
        items.map((i) =>
          i.id === item.id ? { ...i, attempts, state: 'needs_attention', lastError: error } : i,
        ),
      );
      this.deps.notify({
        kind: 'error',
        title: `Could not sync ${item.title}`,
        message: `Gave up after ${MAX_ATTEMPTS} tries: ${e.message} Press Retry to try again.`,
      });
      return false;
    }
    const nextAttemptAt = Math.max(
      e.retryAt?.getTime() ?? 0,
      this.deps.now() + backoffDelay(attempts),
    );
    await this.write((items) =>
      items.map((i) =>
        i.id === item.id ? { ...i, attempts, nextAttemptAt, lastError: error } : i,
      ),
    );
    // Network/GitHub outages affect everything: stop and wait for the backoff.
    return (
      e.code === 'NETWORK_ERROR' ||
      e.code === 'GITHUB_UNAVAILABLE' ||
      e.code === 'GITHUB_RATE_LIMITED'
    );
  }

  /**
   * Makes every parked/backed-off item due now (after reconnecting, fixing settings, or "Retry"),
   * with a fresh set of automatic tries.
   */
  async retryAll(): Promise<void> {
    const now = this.deps.now();
    await this.write((items) =>
      items.map((i) =>
        i.state === 'held' ? i : { ...i, state: 'pending', attempts: 0, nextAttemptAt: now },
      ),
    );
    await this.process();
  }

  async approve(id: string): Promise<void> {
    const now = this.deps.now();
    await this.write((items) =>
      items.map((i) =>
        i.id === id ? { ...i, state: 'pending', attempts: 0, nextAttemptAt: now } : i,
      ),
    );
    await this.process();
  }

  async discard(id: string): Promise<void> {
    await this.write((items) => items.filter((i) => i.id !== id));
    await this.reschedule();
  }

  async state(): Promise<QueueState> {
    return {
      items: await this.deps.storage.get('syncQueue'),
      recent: await this.deps.storage.get('recentSyncs'),
    };
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writes.then(fn, fn);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async write(fn: (items: QueueItem[]) => QueueItem[]): Promise<void> {
    const items = await this.serial(() => this.deps.storage.update('syncQueue', fn));
    this.deps.onChange?.(items);
  }

  private async record(item: QueueItem, result: SyncResultDto): Promise<void> {
    const entry: LocalSyncRecord = {
      id: item.id,
      title: item.title,
      at: new Date(this.deps.now()).toISOString(),
      result,
    };
    await this.serial(() =>
      this.deps.storage.update('recentSyncs', (list) => [entry, ...list].slice(0, MAX_RECENT)),
    );
  }

  private announce(item: QueueItem, result: SyncResultDto): void {
    if (item.request.submission.status !== 'accepted') return; // failed attempts are recorded silently
    this.deps.notify({
      kind: result.outcome === 'committed' ? 'success' : 'info',
      title: result.outcome === 'committed' ? 'Synced to GitHub' : 'LeetCode Sync',
      message: result.message,
      url: result.commitUrl,
    });
  }

  private async reschedule(): Promise<void> {
    const pending = (await this.deps.storage.get('syncQueue')).filter((i) => i.state === 'pending');
    this.deps.scheduleWake(
      pending.length ? Math.min(...pending.map((i) => i.nextAttemptAt)) : null,
    );
  }
}
