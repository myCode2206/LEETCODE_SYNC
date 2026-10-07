import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { DEFAULT_REPOSITORY_SETTINGS } from '@lcsync/shared';
import type {
  RepositorySettings,
  SyncProblemRequest,
  SyncProblemRequestInput,
} from '@lcsync/shared';
import { SyncProblemRequestSchema } from '@lcsync/shared';
import { createApp } from '../../src/app.js';
import type { Clock } from '../../src/common/clock.js';
import { silentLogger } from '../../src/common/logger.js';
import type { AppConfig } from '../../src/config/env.js';
import { createContainer } from '../../src/container.js';
import { FakeGitHub, FakeOAuth } from './fake-github.js';
import { createTestDatabase } from './test-db.js';

export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
export const REDIRECT_URI = `https://${EXTENSION_ID}.chromiumapp.org/github`;

export class MutableClock implements Clock {
  constructor(public current = new Date('2026-10-07T10:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advanceHours(h: number): void {
    this.current = new Date(this.current.getTime() + h * 3600_000);
  }
}

export function testConfig(): AppConfig {
  return {
    env: 'test',
    port: 0,
    publicBaseUrl: 'http://localhost:4000',
    logLevel: 'error',
    databaseUrl: 'pglite://',
    github: { clientId: 'client-id', clientSecret: 'client-secret' },
    tokenEncryptionKey: randomBytes(32),
    allowedExtensionIds: [EXTENSION_ID],
    sessionTtlDays: 30,
  };
}

export async function createTestContext() {
  const db = await createTestDatabase();
  const github = new FakeGitHub();
  const oauth = new FakeOAuth();
  const clock = new MutableClock();
  const container = createContainer(testConfig(), db, silentLogger, {
    githubApiFactory: (token) => github.api(token),
    oauthClient: oauth,
    clock,
  });
  const app = createApp(container);
  return { db, github, oauth, clock, container, app, http: () => request(app) };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

/** Creates a user directly through the account service (bypasses HTTP OAuth). */
export async function createUser(
  ctx: TestContext,
  login = 'rajat',
  scopes: string[] = ['repo'],
): Promise<{ userId: string; token: string }> {
  const token = `gho_${login}_${randomBytes(4).toString('hex')}`;
  const user = { id: Math.floor(Math.random() * 1e9), login, avatarUrl: null };
  ctx.github.addToken(token, user, scopes);
  const userId = await ctx.container.accounts.upsertFromOAuth(user, token, scopes);
  return { userId, token };
}

/** Runs the real HTTP OAuth flow and returns a session token. */
export async function loginViaHttp(ctx: TestContext, login = 'rajat', scopes: string[] = ['repo']) {
  const ghToken = `gho_http_${login}`;
  ctx.github.addToken(ghToken, { id: login.length * 7919, login, avatarUrl: null }, scopes);
  const start = await ctx
    .http()
    .get('/api/v1/auth/github')
    .query({ redirect_uri: REDIRECT_URI, access: 'private' });
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  ctx.oauth.codes.set('github-code', { accessToken: ghToken, scopes });
  const cb = await ctx
    .http()
    .get('/api/v1/auth/github/callback')
    .query({ code: 'github-code', state });
  const code = new URL(cb.headers.location as string).searchParams.get('code')!;
  const session = await ctx.http().post('/api/v1/auth/token').send({ code });
  return { sessionToken: session.body.sessionToken as string, ghToken, body: session.body };
}

export async function configureRepo(
  ctx: TestContext,
  userId: string,
  repoId: number,
  opts: { branch?: string; rootDir?: string; settings?: Partial<RepositorySettings> } = {},
) {
  return ctx.container.repositories.configure(userId, {
    githubRepoId: repoId,
    branch: opts.branch ?? 'main',
    rootDir: opts.rootDir ?? '',
    settings: { ...DEFAULT_REPOSITORY_SETTINGS, ...opts.settings },
  });
}

let submissionCounter = 1_000_000;

export const TWO_SUM = {
  questionId: '1',
  frontendId: '1',
  title: 'Two Sum',
  titleSlug: 'two-sum',
  difficulty: 'Easy' as const,
  topics: [
    { name: 'Array', slug: 'array' },
    { name: 'Hash Table', slug: 'hash-table' },
  ],
};

export const WORD_SEARCH = {
  questionId: '79',
  frontendId: '79',
  title: 'Word Search',
  titleSlug: 'word-search',
  difficulty: 'Medium' as const,
  topics: [
    { name: 'Array', slug: 'array' },
    { name: 'Backtracking', slug: 'backtracking' },
    { name: 'Matrix', slug: 'matrix' },
    { name: 'Depth-First Search', slug: 'depth-first-search' },
    { name: 'Graph', slug: 'graph' },
  ],
};

export const PY_TWO_SUM = `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, n in enumerate(nums):
            if target - n in seen:
                return [seen[target - n], i]
            seen[n] = i
`;

/** Builds a valid sync request; every call gets a fresh LeetCode submission id. */
export function submission(
  overrides: {
    problem?: Partial<SyncProblemRequestInput['problem']>;
    submission?: Partial<SyncProblemRequestInput['submission']>;
    commit?: boolean;
  } = {},
): SyncProblemRequest {
  const id = String(submissionCounter++);
  return SyncProblemRequestSchema.parse({
    idempotencyKey: `submission:${overrides.submission?.leetcodeSubmissionId ?? id}`,
    problem: { ...TWO_SUM, ...overrides.problem },
    submission: {
      leetcodeSubmissionId: id,
      status: 'accepted',
      language: 'python3',
      code: PY_TWO_SUM,
      runtime: '3 ms',
      memory: '17.9 MB',
      runtimeMs: 3,
      submittedAt: '2026-10-07T10:00:00Z',
      ...overrides.submission,
    },
    options: { commit: overrides.commit ?? true },
  });
}
