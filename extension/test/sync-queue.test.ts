import { describe, expect, it } from 'vitest';
import type { SyncProblemRequestInput, SyncResultDto } from '@lcsync/shared';
import { backoffDelay, SyncQueue } from '../src/background/sync-queue.js';
import type { Notice } from '../src/background/sync-queue.js';
import { ApiError } from '../src/services/api-client.js';
import { memoryArea, TypedStorage } from '../src/storage/storage.js';

function request(
  id: string,
  status: 'accepted' | 'wrong_answer' = 'accepted',
): SyncProblemRequestInput {
  return {
    idempotencyKey: `submission:${id}`,
    problem: {
      questionId: '1',
      frontendId: '1',
      title: 'Two Sum',
      titleSlug: 'two-sum',
      difficulty: 'Easy',
      topics: [],
    },
    submission: {
      leetcodeSubmissionId: id,
      status,
      language: 'python3',
      code: 'x',
      submittedAt: '2026-10-07T10:00:00Z',
    },
  };
}

const ok = (message = '✓ Two Sum synced to GitHub'): SyncResultDto => ({
  jobId: 'j',
  outcome: 'committed',
  duplicate: false,
  changeKind: 'new_problem',
  commitSha: 'abc',
  commitUrl: 'https://github.com/me/r/commit/abc',
  message,
  problem: { slug: 'two-sum', frontendId: '1', title: 'Two Sum' },
});

function setup(sync: (r: SyncProblemRequestInput) => Promise<SyncResultDto>) {
  let clock = 1_000_000;
  const notices: Notice[] = [];
  const wakes: (number | null)[] = [];
  const storage = new TypedStorage(memoryArea());
  const sent: string[] = [];
  const queue = new SyncQueue({
    storage,
    sync: async (r) => {
      sent.push(r.idempotencyKey);
      return sync(r);
    },
    now: () => clock,
    notify: (n) => notices.push(n),
    scheduleWake: (at) => wakes.push(at),
  });
  return {
    queue,
    storage,
    notices,
    wakes,
    sent,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

describe('SyncQueue', () => {
  it('syncs, removes the item, records it and notifies', async () => {
    const t = setup(async () => ok());
    expect(await t.queue.enqueue(request('1'), { hold: false })).toBe('queued');
    await t.queue.process();
    const state = await t.queue.state();
    expect(state.items).toEqual([]);
    expect(state.recent[0]!.result.message).toBe('✓ Two Sum synced to GitHub');
    expect(t.notices[0]).toMatchObject({
      kind: 'success',
      url: 'https://github.com/me/r/commit/abc',
    });
  });

  it('ignores repeated detections of the same submission', async () => {
    const t = setup(async () => ok());
    await t.queue.enqueue(request('1'), { hold: false });
    await t.queue.process();
    expect(await t.queue.enqueue(request('1'), { hold: false })).toBe('duplicate');
    expect(t.sent).toEqual(['submission:1']);
  });

  it('keeps items through network failures and retries with backoff', async () => {
    let online = false;
    const t = setup(async () => {
      if (!online) throw new ApiError('NETWORK_ERROR', 'offline', 0, true);
      return ok();
    });
    await t.queue.enqueue(request('1'), { hold: false });
    await t.queue.enqueue(request('2'), { hold: false });
    await t.queue.process();

    let items = (await t.queue.state()).items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ attempts: 1, lastError: { code: 'NETWORK_ERROR' } });
    expect(t.wakes.at(-1)).toBe(t.now() + 30_000);

    await t.queue.process(); // not due yet
    expect((await t.queue.state()).items[0]!.attempts).toBe(1);

    online = true;
    t.advance(30_000);
    await t.queue.process();
    items = (await t.queue.state()).items;
    expect(items).toEqual([]);
    expect(t.sent.slice(-2).sort()).toEqual(['submission:1', 'submission:2']);
    expect(t.wakes.at(-1)).toBeNull();
  });

  it('respects GitHub rate-limit reset times', async () => {
    const t = setup(async () => {
      throw new ApiError(
        'GITHUB_RATE_LIMITED',
        'rate limited',
        429,
        true,
        new Date(1_000_000 + 3_600_000),
      );
    });
    await t.queue.enqueue(request('1'), { hold: false });
    await t.queue.process();
    expect((await t.queue.state()).items[0]!.nextAttemptAt).toBe(1_000_000 + 3_600_000);
  });

  it('parks all items when the user must act, and resumes after retryAll', async () => {
    let expired = true;
    const t = setup(async () => {
      if (expired)
        throw new ApiError(
          'GITHUB_AUTH_EXPIRED',
          'GitHub authorization has expired. Please reconnect GitHub.',
          401,
          false,
        );
      return ok();
    });
    await t.queue.enqueue(request('1'), { hold: false });
    await t.queue.enqueue(request('2'), { hold: false });
    await t.queue.process();
    const items = (await t.queue.state()).items;
    expect(items.map((i) => i.state)).toEqual(['needs_attention', 'needs_attention']);
    expect(t.notices.at(-1)).toMatchObject({
      kind: 'error',
      message: 'GitHub authorization has expired. Please reconnect GitHub.',
    });

    expired = false;
    await t.queue.retryAll();
    expect((await t.queue.state()).items).toEqual([]);
  });

  it('holds items when auto-sync is off until approved or discarded', async () => {
    const t = setup(async () => ok());
    await t.queue.enqueue(request('1'), { hold: true });
    await t.queue.enqueue(request('2'), { hold: true });
    await t.queue.process();
    expect(t.sent).toEqual([]);
    await t.queue.approve('submission:1');
    expect(t.sent).toEqual(['submission:1']);
    await t.queue.discard('submission:2');
    expect((await t.queue.state()).items).toEqual([]);
  });

  it('does not notify for failed submissions', async () => {
    const t = setup(async () => ({ ...ok('Wrong Answer recorded'), outcome: 'recorded' }));
    await t.queue.enqueue(request('9', 'wrong_answer'), { hold: false });
    await t.queue.process();
    expect(t.notices).toEqual([]);
  });

  it('computes capped exponential backoff', () => {
    expect([1, 2, 3, 4].map(backoffDelay)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffDelay(20)).toBe(30 * 60_000);
  });
});
