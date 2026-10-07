import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/common/app-error.js';
import {
  configureRepo,
  createTestContext,
  createUser,
  PY_TWO_SUM,
  submission,
  WORD_SEARCH,
} from './helpers/test-context.js';
import type { TestContext } from './helpers/test-context.js';

const CPP_TWO_SUM = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> seen;
        for (int i = 0; i < nums.size(); i++) {
            if (seen.count(target - nums[i])) return {seen[target - nums[i]], i};
            seen[nums[i]] = i;
        }
        return {};
    }
};`;

describe('sync pipeline', () => {
  let ctx: TestContext;
  let userId: string;
  let repoId: number;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ userId } = await createUser(ctx));
    repoId = ctx.github.createRepo('rajat', 'leetcode-solutions').id;
    await configureRepo(ctx, userId, repoId);
  });

  afterEach(async () => {
    await ctx.db.destroy();
  });

  const sync = (req = submission()) => ctx.container.sync.syncSubmission(userId, req);
  const files = () => ctx.github.files(repoId);
  const problemDirs = () =>
    new Set(
      [...files().keys()].filter((p) => p.startsWith('problems/')).map((p) => p.split('/')[1]),
    );
  const metadata = (dir = '0001-two-sum') =>
    JSON.parse(files().get(`problems/${dir}/metadata.json`)!) as Record<string, unknown>;

  it('creates the canonical problem directory, indexes and README on first accepted sync', async () => {
    const result = await sync();

    expect(result.outcome).toBe('committed');
    expect(result.changeKind).toBe('new_problem');
    expect(result.message).toBe('✓ Two Sum synced to GitHub');
    expect(result.commitUrl).toMatch(
      /^https:\/\/github\.com\/rajat\/leetcode-solutions\/commit\/[0-9a-f]+$/,
    );
    expect(ctx.github.log(repoId)[0]).toBe('leetcode: add #1 Two Sum');

    const f = files();
    expect(f.get('problems/0001-two-sum/solutions/python.py')).toBe(PY_TWO_SUM);
    expect(f.get('problems/0001-two-sum/README.md')).toContain('# 1. Two Sum');
    expect(f.has('topics/array.md')).toBe(true);
    expect(f.has('topics/hash-table.md')).toBe(true);
    expect(f.get('topics/array.md')).toContain('[1. Two Sum](../problems/0001-two-sum/)');
    expect(f.get('difficulty/easy.md')).toContain('[1. Two Sum](../problems/0001-two-sum/)');
    expect(f.get('languages/python.md')).toContain('../problems/0001-two-sum/solutions/python.py');
    expect(f.has('stats/stats.json')).toBe(true);
    // GitHub's auto-created README heading is kept; the generated block is appended.
    expect(f.get('README.md')).toMatch(/^# leetcode-solutions\n\n<!-- leetcode-sync:start -->/);
    expect(f.get('README.md')).toContain('| [Array](topics/array.md) | 1 |');

    expect(metadata()).toMatchObject({
      id: 1,
      title: 'Two Sum',
      slug: 'two-sum',
      difficulty: 'Easy',
      topics: ['Array', 'Hash Table'],
      languages: ['Python'],
      attemptCount: 1,
      acceptedCount: 1,
      revisionCount: 1,
      firstSolvedAt: '2026-10-07T10:00:00.000Z',
    });
  });

  it('is idempotent: the same submission processed twice does not duplicate anything', async () => {
    const req = submission();
    const first = await sync(req);
    const second = await sync(req);

    expect(second.duplicate).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    expect(second.commitSha).toBe(first.commitSha);
    expect(ctx.github.log(repoId)).toHaveLength(2); // initial + one sync commit
    const [p] = await ctx.container.problems.list(userId);
    expect(p!.attemptCount).toBe(1);
    expect(p!.acceptedCount).toBe(1);
  });

  it('handles concurrent deliveries of the same submission with one commit', async () => {
    const req = submission();
    const results = await Promise.all([sync(req), sync(req), sync(req)]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(ctx.github.log(repoId)).toHaveLength(2);
  });

  it('treats a new submission with identical code as a recorded attempt without a commit', async () => {
    await sync();
    ctx.clock.advanceHours(24);
    const again = await sync(
      submission({
        submission: { submittedAt: '2026-10-08T10:00:00Z', code: PY_TWO_SUM + '\n\n' },
      }),
    );

    expect(again.outcome).toBe('recorded');
    expect(again.message).toContain('identical solution');
    expect(ctx.github.log(repoId)).toHaveLength(2);
    const [p] = await ctx.container.problems.list(userId);
    expect(p!.attemptCount).toBe(2);
    expect(p!.acceptedCount).toBe(2);
    expect(p!.revisionCount).toBe(2);
    expect(p!.status).toBe('revised');
  });

  it('commits identical resubmissions when metadata-only commits are enabled', async () => {
    await configureRepo(ctx, userId, repoId, { settings: { commitMetadataOnlyChanges: true } });
    await sync();
    const again = await sync(submission({ submission: { submittedAt: '2026-10-08T10:00:00Z' } }));
    expect(again.outcome).toBe('committed');
    expect(again.changeKind).toBe('metadata');
    expect(ctx.github.log(repoId)[0]).toBe('leetcode: update #1 Two Sum');
    expect(metadata().attemptCount).toBe(2);
  });

  it('updates the existing solution when the code changes and keeps one directory', async () => {
    await sync();
    const improved = PY_TWO_SUM.replace('seen = {}', 'seen: dict[int, int] = {}');
    const result = await sync(
      submission({ submission: { code: improved, submittedAt: '2026-10-08T10:00:00Z' } }),
    );

    expect(result.changeKind).toBe('improved');
    expect(ctx.github.log(repoId)[0]).toBe('leetcode: improve #1 Two Sum');
    expect(files().get('problems/0001-two-sum/solutions/python.py')).toBe(improved);
    expect(problemDirs()).toEqual(new Set(['0001-two-sum']));
    expect(metadata().acceptedCount).toBe(2);
  });

  it('adds another language to the same problem directory', async () => {
    await sync();
    const result = await sync(submission({ submission: { language: 'cpp', code: CPP_TWO_SUM } }));

    expect(result.changeKind).toBe('new_language');
    expect(ctx.github.log(repoId)[0]).toBe('leetcode: add #1 Two Sum (C++)');
    expect(problemDirs()).toEqual(new Set(['0001-two-sum']));
    const f = files();
    expect(f.get('problems/0001-two-sum/solutions/cpp.cpp')).toBe(CPP_TWO_SUM + '\n');
    expect(f.has('problems/0001-two-sum/solutions/python.py')).toBe(true);
    expect(metadata().languages).toEqual(['C++', 'Python']);
    expect(f.get('languages/cpp.md')).toContain('solutions/cpp.cpp');
    expect(f.get('problems/0001-two-sum/README.md')).toContain('## Solutions');
  });

  it('indexes a multi-topic problem in every topic without duplicating the solution', async () => {
    await sync(submission({ problem: WORD_SEARCH, submission: { code: 'class Solution: pass' } }));
    const f = files();

    const solutionFiles = [...f.keys()].filter((p) => p.endsWith('python.py'));
    expect(solutionFiles).toEqual(['problems/0079-word-search/solutions/python.py']);
    for (const topic of ['array', 'backtracking', 'matrix', 'depth-first-search', 'graph']) {
      expect(f.get(`topics/${topic}.md`)).toContain(
        '[79. Word Search](../problems/0079-word-search/)',
      );
    }
    expect([...f.keys()].some((p) => p.startsWith('topics/array/'))).toBe(false);
    // Topics that are patterns are suggested as patterns (stored separately).
    expect(f.get('patterns/backtracking.md')).toContain('../problems/0079-word-search/');
    expect(f.get('patterns/dfs.md')).toContain('../problems/0079-word-search/');
  });

  it('records failed submissions without committing or storing their code', async () => {
    await sync();
    const failed = await sync(
      submission({
        submission: { status: 'wrong_answer', code: undefined, codeHash: 'a'.repeat(64) },
      }),
    );
    expect(failed.outcome).toBe('recorded');
    expect(failed.message).toBe('Wrong Answer recorded for Two Sum.');
    expect(ctx.github.log(repoId)).toHaveLength(2);

    const detail = await ctx.container.problems.detail(userId, 'two-sum');
    expect(detail.attemptCount).toBe(2);
    expect(detail.wrongAnswerCount).toBe(1);
    expect(detail.submissions.find((s) => s.status === 'wrong_answer')!.hasCode).toBe(false);
  });

  it('does not create files for a problem that was never accepted', async () => {
    const result = await sync(
      submission({
        submission: { status: 'time_limit_exceeded', code: undefined, codeHash: 'b'.repeat(64) },
      }),
    );
    expect(result.outcome).toBe('recorded');
    expect(problemDirs().size).toBe(0);
    expect(await ctx.container.problems.list(userId)).toEqual([]);
  });

  it('never loses a solution when GitHub fails, and the retry commits exactly once', async () => {
    ctx.github.failNext('createCommit', () => new AppError('GITHUB_UNAVAILABLE', 'GitHub is down'));
    const req = submission();
    await expect(sync(req)).rejects.toMatchObject({ code: 'GITHUB_UNAVAILABLE', retryable: true });
    expect(ctx.github.log(repoId)).toHaveLength(1);

    const [pending] = await ctx.container.problems.list(userId);
    expect(pending!.githubUrl).toBeNull();
    expect((await ctx.container.stats.stats(userId)).pendingCommitCount).toBe(1);

    const retry = await sync(req);
    expect(retry.outcome).toBe('committed');
    expect(retry.duplicate).toBe(false);
    expect(ctx.github.log(repoId)).toHaveLength(2);
    const [p] = await ctx.container.problems.list(userId);
    expect(p!.attemptCount).toBe(1);
    expect(p!.githubUrl).toBe(
      'https://github.com/rajat/leetcode-solutions/tree/main/problems/0001-two-sum',
    );
  });

  it('surfaces rate limits with a retry time', async () => {
    const retryAt = new Date(Date.now() + 15 * 60_000);
    ctx.github.failNext(
      'getRepositoryById',
      () => new AppError('GITHUB_RATE_LIMITED', 'GitHub rate limit reached.', { retryAt }),
    );
    await expect(sync()).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED', retryAt });
  });

  it('includes previously failed problems in the next commit', async () => {
    ctx.github.failNext('createCommit', () => new AppError('GITHUB_UNAVAILABLE', 'down'));
    await expect(sync()).rejects.toThrow();
    await sync(submission({ problem: WORD_SEARCH, submission: { code: 'pass' } }));
    expect(ctx.github.log(repoId)[0]).toBe('leetcode: add #79 Word Search (+1 more)');
    expect(problemDirs()).toEqual(new Set(['0001-two-sum', '0079-word-search']));
  });

  it('records but does not commit when automatic commits are off, then pushes pending changes', async () => {
    const result = await sync(submission({ commit: false }));
    expect(result.outcome).toBe('recorded');
    expect(ctx.github.log(repoId)).toHaveLength(1);

    const pushed = await ctx.container.sync.pushPending(userId);
    expect(pushed.outcome).toBe('committed');
    expect(ctx.github.log(repoId)[0]).toBe('leetcode: add #1 Two Sum');

    const nothing = await ctx.container.sync.pushPending(userId);
    expect(nothing.outcome).toBe('up_to_date');
  });

  it('keeps solutions when no repository is configured and publishes them later', async () => {
    const other = await createUser(ctx, 'someone');
    const repo = ctx.github.createRepo('someone', 'dsa');
    const result = await ctx.container.sync.syncSubmission(other.userId, submission());
    expect(result.outcome).toBe('recorded');
    expect(result.message).toContain('Choose a GitHub repository');

    await configureRepo(ctx, other.userId, repo.id);
    await ctx.container.sync.pushPending(other.userId);
    expect(ctx.github.files(repo.id).has('problems/0001-two-sum/solutions/python.py')).toBe(true);
  });

  it('backfills everything into a newly selected repository or branch', async () => {
    await sync();
    const second = ctx.github.createRepo('rajat', 'dsa-notes', { private: true });
    await configureRepo(ctx, userId, second.id, { rootDir: 'leetcode' });
    await sync(submission({ problem: WORD_SEARCH, submission: { code: 'pass' } }));

    const f = ctx.github.files(second.id);
    expect(f.has('leetcode/problems/0001-two-sum/solutions/python.py')).toBe(true);
    expect(f.has('leetcode/problems/0079-word-search/solutions/python.py')).toBe(true);
    expect(f.get('leetcode/topics/array.md')).toContain('0001-two-sum');
    expect(f.has('leetcode/README.md')).toBe(true);
    expect(f.get('README.md')).toBe('# dsa-notes\n'); // nothing outside the root dir is touched
  });

  it('keeps the original directory when LeetCode renames a problem', async () => {
    await sync();
    await sync(
      submission({
        problem: { title: 'Two Sum (Classic)', titleSlug: 'two-sum-classic' },
        submission: { code: PY_TWO_SUM + '# v2\n' },
      }),
    );
    expect(problemDirs()).toEqual(new Set(['0001-two-sum']));
    expect(files().get('problems/0001-two-sum/README.md')).toContain('# 1. Two Sum (Classic)');
  });

  it('distinguishes problems with the same title but different ids', async () => {
    await sync();
    await sync(
      submission({
        problem: { questionId: '9001', frontendId: 'LCP 01', titleSlug: 'two-sum-lcp' },
      }),
    );
    expect(problemDirs()).toEqual(new Set(['0001-two-sum', 'lcp-01-two-sum-lcp']));
  });

  it('handles problems without topics', async () => {
    await sync(submission({ problem: { topics: [] } }));
    const f = files();
    expect(f.has('problems/0001-two-sum/README.md')).toBe(true);
    expect([...f.keys()].filter((p) => p.startsWith('topics/'))).toEqual(['topics/README.md']);
    expect(f.get('problems/0001-two-sum/README.md')).not.toContain('**Topics:**');
  });

  it('honours the "keep first" update policy', async () => {
    await configureRepo(ctx, userId, repoId, { settings: { solutionUpdatePolicy: 'keep_first' } });
    await sync();
    const result = await sync(
      submission({ submission: { code: 'print(1)', submittedAt: '2026-10-08T10:00:00Z' } }),
    );
    expect(result.outcome).toBe('recorded');
    expect(files().get('problems/0001-two-sum/solutions/python.py')).toBe(PY_TWO_SUM);
  });

  it('honours the "best runtime" update policy', async () => {
    await configureRepo(ctx, userId, repoId, {
      settings: { solutionUpdatePolicy: 'best_runtime' },
    });
    await sync(submission({ submission: { runtimeMs: 5, runtime: '5 ms' } }));
    await sync(
      submission({
        submission: { code: 'slow', runtimeMs: 9, submittedAt: '2026-10-08T10:00:00Z' },
      }),
    );
    expect(files().get('problems/0001-two-sum/solutions/python.py')).toBe(PY_TWO_SUM);
    await sync(
      submission({
        submission: { code: 'fast', runtimeMs: 1, submittedAt: '2026-10-09T10:00:00Z' },
      }),
    );
    expect(files().get('problems/0001-two-sum/solutions/python.py')).toBe('fast\n');
  });

  it('does not let an out-of-order older submission overwrite newer code', async () => {
    await sync(submission({ submission: { code: 'newest', submittedAt: '2026-10-07T10:00:00Z' } }));
    await sync(submission({ submission: { code: 'older', submittedAt: '2026-10-01T10:00:00Z' } }));
    expect(files().get('problems/0001-two-sum/solutions/python.py')).toBe('newest\n');
    // No code change → no commit, but the database knows the true first solve date.
    expect(ctx.github.log(repoId)).toHaveLength(2);
    const detail = await ctx.container.problems.detail(userId, 'two-sum');
    expect(detail.firstSolvedAt).toBe('2026-10-01T10:00:00.000Z');
  });

  it('counts revision sessions, not every accepted submission', async () => {
    await sync(submission({ submission: { submittedAt: '2026-09-01T10:00:00Z' } }));
    await sync(submission({ submission: { submittedAt: '2026-09-01T10:30:00Z' } })); // same session
    await sync(submission({ submission: { submittedAt: '2026-09-05T10:00:00Z' } }));
    await sync(submission({ submission: { submittedAt: '2026-09-20T10:00:00Z' } }));
    await sync(submission({ submission: { submittedAt: '2026-10-07T09:00:00Z' } }));
    const detail = await ctx.container.problems.detail(userId, 'two-sum');
    expect(detail.acceptedCount).toBe(5);
    expect(detail.revisionCount).toBe(4);
    expect(detail.lastRevisedAt).toBe('2026-10-07T09:00:00.000Z');
    expect(detail.revisions.map((r) => r.type)).toEqual([
      'resolve',
      'resolve',
      'resolve',
      'first_solve',
    ]);
  });

  it('resumes after a concurrent push to the branch', async () => {
    let pushed = false;
    ctx.github.beforeUpdateBranch = (id, branch) => {
      if (!pushed) {
        pushed = true;
        ctx.github.pushFile(id, branch, 'NOTES.md', 'my notes\n');
      }
    };
    await sync();
    expect(files().get('NOTES.md')).toBe('my notes\n');
    expect(files().has('problems/0001-two-sum/solutions/python.py')).toBe(true);
    expect(ctx.github.log(repoId).slice(0, 2)).toEqual([
      'leetcode: add #1 Two Sum',
      'external change',
    ]);
  });

  it('flags the account for reconnection when the GitHub token is revoked', async () => {
    const { userId: u, token } = await createUser(ctx, 'revoked-user');
    const repo = ctx.github.createRepo('revoked-user', 'solutions');
    await configureRepo(ctx, u, repo.id);
    ctx.github.revokeToken(token);
    await expect(ctx.container.sync.syncSubmission(u, submission())).rejects.toMatchObject({
      code: 'GITHUB_AUTH_EXPIRED',
      message: 'GitHub authorization has expired. Please reconnect GitHub.',
    });
    expect((await ctx.container.accounts.getAccountDto(u))!.needsReconnect).toBe(true);
  });
});
