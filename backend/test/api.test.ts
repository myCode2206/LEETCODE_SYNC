import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REPOSITORY_SETTINGS } from '@lcsync/shared';
import {
  createTestContext,
  EXTENSION_ID,
  loginViaHttp,
  REDIRECT_URI,
  submission,
  WORD_SEARCH,
} from './helpers/test-context.js';
import type { TestContext } from './helpers/test-context.js';

describe('HTTP API', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.db.destroy();
  });

  const authed = (token: string) => ({
    get: (url: string) => ctx.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => ctx.http().post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => ctx.http().put(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => ctx.http().patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => ctx.http().delete(url).set('Authorization', `Bearer ${token}`),
  });

  describe('authentication', () => {
    it('runs the OAuth flow without exposing the GitHub token to the client', async () => {
      const start = await ctx
        .http()
        .get('/api/v1/auth/github')
        .query({ redirect_uri: REDIRECT_URI, access: 'private' });
      expect(start.status).toBe(302);
      const authorize = new URL(start.headers.location as string);
      expect(authorize.searchParams.get('scope')).toBe('repo');
      expect(authorize.searchParams.get('redirect_uri')).toBe(
        'http://localhost:4000/api/v1/auth/github/callback',
      );

      const { sessionToken, ghToken, body } = await loginViaHttp(ctx);
      expect(sessionToken).toMatch(/^lcs_/);
      expect(JSON.stringify(body)).not.toContain(ghToken);
      expect(body.me.github).toMatchObject({
        login: 'rajat',
        accessLevel: 'private',
        needsReconnect: false,
      });

      const row = await ctx.db.selectFrom('github_accounts').selectAll().executeTakeFirstOrThrow();
      expect(row.access_token_encrypted).not.toContain(ghToken); // encrypted at rest
      const session = await ctx.db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
      expect(session.token_hash).not.toBe(sessionToken); // only the hash is stored
    });

    it('requests only public_repo for public access', async () => {
      const start = await ctx
        .http()
        .get('/api/v1/auth/github')
        .query({ redirect_uri: REDIRECT_URI, access: 'public' });
      expect(new URL(start.headers.location as string).searchParams.get('scope')).toBe(
        'public_repo',
      );
    });

    it('rejects redirect URIs that are not an allowed extension', async () => {
      for (const uri of [
        'https://evil.example.com/cb',
        'https://ponmlkjihgfedcbaponmlkjihgfedcba.chromiumapp.org/github',
        `http://${EXTENSION_ID}.chromiumapp.org/github`,
      ]) {
        const res = await ctx.http().get('/api/v1/auth/github').query({ redirect_uri: uri });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('pre-checks the redirect URI without starting a login', async () => {
      const ok = await ctx
        .http()
        .get('/api/v1/auth/github/check')
        .query({ redirect_uri: REDIRECT_URI });
      expect(ok.status).toBe(204);
      expect(await ctx.db.selectFrom('oauth_states').selectAll().execute()).toHaveLength(0);

      const bad = await ctx
        .http()
        .get('/api/v1/auth/github/check')
        .query({ redirect_uri: 'https://evil.example.com/cb' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    });

    describe('sign-in links (another browser or profile)', () => {
      const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
      const createLink = () =>
        ctx
          .http()
          .post('/api/v1/auth/github/link')
          .set('Origin', ORIGIN)
          .send({ access: 'public' });
      const poll = (pollToken: string) =>
        ctx.http().post('/api/v1/auth/github/link/poll').send({ pollToken });
      const linkPath = (url: string) => new URL(url).pathname;

      it('signs in through a link opened elsewhere, once', async () => {
        ctx.github.addToken('gho_link', { id: 42, login: 'linker', avatarUrl: null }, [
          'public_repo',
        ]);
        const link = await createLink();
        expect(link.status).toBe(201);
        const { url, code, pollToken } = link.body;
        expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
        expect((await poll(pollToken)).body).toEqual({ status: 'pending' });

        const confirm = await ctx.http().get(linkPath(url));
        expect(confirm.status).toBe(200);
        expect(confirm.text).toContain(code);

        const start = await ctx.http().get(`${linkPath(url)}/continue`);
        const authorize = new URL(start.headers.location as string);
        expect(authorize.searchParams.get('scope')).toBe('public_repo');
        ctx.oauth.codes.set('link-code', { accessToken: 'gho_link', scopes: ['public_repo'] });
        const cb = await ctx
          .http()
          .get('/api/v1/auth/github/callback')
          .query({ code: 'link-code', state: authorize.searchParams.get('state') });
        expect(cb.status).toBe(200);
        expect(cb.text).toContain('GitHub connected');

        const done = await poll(pollToken);
        expect(done.body.status).toBe('complete');
        expect(done.body.session.me.github.login).toBe('linker');
        const me = await authed(done.body.session.sessionToken).get('/api/v1/auth/me');
        expect(me.status).toBe(200);

        expect((await poll(pollToken)).status).toBe(401);
        expect((await ctx.http().get(linkPath(url))).status).toBe(400);
      });

      it('keeps the link usable after GitHub access is denied', async () => {
        const { url, pollToken } = (await createLink()).body;
        const start = await ctx.http().get(`${linkPath(url)}/continue`);
        const state = new URL(start.headers.location as string).searchParams.get('state');
        const cb = await ctx
          .http()
          .get('/api/v1/auth/github/callback')
          .query({ error: 'access_denied', state });
        expect(cb.status).toBe(400);
        expect(cb.text).toContain('Open the same link again');
        expect((await poll(pollToken)).body).toEqual({ status: 'pending' });
        expect((await ctx.http().get(linkPath(url))).status).toBe(200);
      });

      it('only lets the extension create links', async () => {
        for (const origin of [undefined, 'https://evil.example.com']) {
          const req = ctx.http().post('/api/v1/auth/github/link');
          const res = await (origin ? req.set('Origin', origin) : req).send({});
          expect(res.status).toBe(400);
        }
      });
    });

    it('rejects an unknown OAuth state with a readable page', async () => {
      const res = await ctx
        .http()
        .get('/api/v1/auth/github/callback')
        .query({ code: 'x', state: 'forged' });
      expect(res.status).toBe(400);
      expect(res.text).toContain('This sign-in link has expired');
    });

    it('redirects back with an error when the user denies access', async () => {
      const start = await ctx
        .http()
        .get('/api/v1/auth/github')
        .query({ redirect_uri: REDIRECT_URI });
      const state = new URL(start.headers.location as string).searchParams.get('state')!;
      const cb = await ctx
        .http()
        .get('/api/v1/auth/github/callback')
        .query({ error: 'access_denied', state });
      expect(cb.headers.location).toBe(`${REDIRECT_URI}?error=access_denied`);
    });

    it('accepts a login code only once', async () => {
      ctx.github.addToken('gho_x', { id: 7, login: 'x', avatarUrl: null });
      const start = await ctx
        .http()
        .get('/api/v1/auth/github')
        .query({ redirect_uri: REDIRECT_URI });
      const state = new URL(start.headers.location as string).searchParams.get('state')!;
      ctx.oauth.codes.set('c', { accessToken: 'gho_x', scopes: ['public_repo'] });
      const cb = await ctx.http().get('/api/v1/auth/github/callback').query({ code: 'c', state });
      const code = new URL(cb.headers.location as string).searchParams.get('code')!;
      expect((await ctx.http().post('/api/v1/auth/token').send({ code })).status).toBe(200);
      const reuse = await ctx.http().post('/api/v1/auth/token').send({ code });
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns friendly 401s for missing or invalid sessions', async () => {
      const none = await ctx.http().get('/api/v1/stats');
      expect(none.status).toBe(401);
      expect(none.body.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Please connect GitHub to continue.',
      });
      const bad = await authed('lcs_nope').get('/api/v1/stats');
      expect(bad.body.error.message).toBe('Your session has expired. Please connect GitHub again.');
    });

    it('expires sessions', async () => {
      const { sessionToken } = await loginViaHttp(ctx);
      ctx.clock.advanceHours(24 * 31);
      expect((await authed(sessionToken).get('/api/v1/auth/me')).status).toBe(401);
    });

    it('signs out and disconnects (revoking the GitHub grant)', async () => {
      const { sessionToken, ghToken } = await loginViaHttp(ctx);
      expect((await authed(sessionToken).delete('/api/v1/auth/github')).status).toBe(204);
      expect(ctx.oauth.revoked).toEqual([ghToken]);
      expect((await authed(sessionToken).get('/api/v1/auth/me')).status).toBe(401);
      expect(await ctx.db.selectFrom('github_accounts').selectAll().execute()).toEqual([]);
    });
  });

  describe('repository access', () => {
    it('works with public repositories on a public-only grant', async () => {
      const { sessionToken } = await loginViaHttp(ctx, 'pub', ['public_repo']);
      const repo = ctx.github.createRepo('pub', 'leetcode-solutions');
      ctx.github.createRepo('pub', 'secret', { private: true });

      const list = await authed(sessionToken).get('/api/v1/github/repositories');
      expect(list.body.items.map((r: { name: string }) => r.name)).toEqual(['leetcode-solutions']);

      const put = await authed(sessionToken)
        .put('/api/v1/repository')
        .send({ githubRepoId: repo.id, branch: 'main', rootDir: '/' });
      expect(put.status).toBe(200);
      expect(put.body.repository).toMatchObject({
        fullName: 'pub/leetcode-solutions',
        private: false,
        rootDir: '',
      });

      const sync = await authed(sessionToken).post('/api/v1/sync/problem').send(submission());
      expect(sync.status).toBe(201);
      expect(sync.body.outcome).toBe('committed');
    });

    it('explains how to reach a private repository from a public-only grant', async () => {
      const { sessionToken } = await loginViaHttp(ctx, 'pub', ['public_repo']);
      const repo = ctx.github.createRepo('pub', 'secret', { private: true });
      const res = await authed(sessionToken)
        .put('/api/v1/repository')
        .send({ githubRepoId: repo.id, branch: 'main' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({
        code: 'GITHUB_REPO_NOT_FOUND',
        message: expect.stringContaining('reconnect GitHub with "Public and private repositories"'),
      });

      const create = await authed(sessionToken)
        .post('/api/v1/github/repositories')
        .send({ name: 'new', private: true });
      expect(create.status).toBe(403);
      expect(create.body.error.code).toBe('GITHUB_PERMISSION_DENIED');
    });

    it('syncs to private repositories with private access', async () => {
      const { sessionToken } = await loginViaHttp(ctx);
      const created = await authed(sessionToken)
        .post('/api/v1/github/repositories')
        .send({ name: 'leetcode-private', private: true });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ private: true, canPush: true });
      const branches = await authed(sessionToken).get(
        `/api/v1/github/repositories/${created.body.id}/branches`,
      );
      expect(branches.body.items).toEqual([{ name: 'main', protected: false }]);

      await authed(sessionToken)
        .put('/api/v1/repository')
        .send({ githubRepoId: created.body.id, branch: 'main' });
      const sync = await authed(sessionToken).post('/api/v1/sync/problem').send(submission());
      expect(sync.body.outcome).toBe('committed');
      expect(ctx.github.files(created.body.id).has('problems/0001-two-sum/metadata.json')).toBe(
        true,
      );
    });

    it('validates branch, write access and root directory', async () => {
      const { sessionToken } = await loginViaHttp(ctx);
      const repo = ctx.github.createRepo('rajat', 'r');
      const foreign = ctx.github.createRepo('someone-else', 'theirs');
      const put = (body: object) => authed(sessionToken).put('/api/v1/repository').send(body);

      expect((await put({ githubRepoId: repo.id, branch: 'dev' })).body.error.code).toBe(
        'GITHUB_BRANCH_NOT_FOUND',
      );
      expect((await put({ githubRepoId: foreign.id, branch: 'main' })).body.error.code).toBe(
        'GITHUB_PERMISSION_DENIED',
      );
      expect(
        (await put({ githubRepoId: repo.id, branch: 'main', rootDir: '../x' })).body.error.code,
      ).toBe('INVALID_REPOSITORY_CONFIG');
    });

    it('reports a deleted repository at sync time', async () => {
      const { sessionToken } = await loginViaHttp(ctx);
      const repo = ctx.github.createRepo('rajat', 'r');
      await authed(sessionToken)
        .put('/api/v1/repository')
        .send({ githubRepoId: repo.id, branch: 'main' });
      ctx.github.repos.delete(repo.id);
      const res = await authed(sessionToken).post('/api/v1/sync/problem').send(submission());
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'GITHUB_REPO_NOT_FOUND', retryable: false });
    });

    it('follows a renamed repository by id', async () => {
      const { sessionToken } = await loginViaHttp(ctx);
      const repo = ctx.github.createRepo('rajat', 'old-name');
      await authed(sessionToken)
        .put('/api/v1/repository')
        .send({ githubRepoId: repo.id, branch: 'main' });
      repo.name = 'new-name';
      await authed(sessionToken).post('/api/v1/sync/problem').send(submission());
      const me = await authed(sessionToken).get('/api/v1/auth/me');
      expect(me.body.repository.fullName).toBe('rajat/new-name');
    });
  });

  describe('problems, revisions and stats', () => {
    let token: string;
    let repoId: number;

    beforeEach(async () => {
      ({ sessionToken: token } = await loginViaHttp(ctx));
      repoId = ctx.github.createRepo('rajat', 'leetcode-solutions').id;
      await authed(token)
        .put('/api/v1/repository')
        .send({ githubRepoId: repoId, branch: 'main', settings: DEFAULT_REPOSITORY_SETTINGS });
      await authed(token).post('/api/v1/sync/problem').send(submission());
      await authed(token)
        .post('/api/v1/sync/problem')
        .send(
          submission({
            problem: WORD_SEARCH,
            submission: { language: 'java', code: 'class Solution {}' },
          }),
        );
    });

    it('lists and searches problems', async () => {
      const all = await authed(token).get('/api/v1/problems');
      expect(all.body.items.map((p: { frontendId: string }) => p.frontendId)).toEqual(['1', '79']);
      const search = async (q: string) =>
        (await authed(token).get('/api/v1/problems').query({ q })).body.items.map(
          (p: { slug: string }) => p.slug,
        );
      expect(await search('array')).toEqual(['two-sum', 'word-search']);
      expect(await search('backtracking')).toEqual(['word-search']);
      expect(await search('1')).toEqual(['two-sum']);
      expect(await search('java')).toEqual(['word-search']);
      expect(await search('medium')).toEqual(['word-search']);
      const filtered = await authed(token)
        .get('/api/v1/problems')
        .query({ topic: 'hash-table', difficulty: 'Easy' });
      expect(filtered.body.items).toHaveLength(1);
    });

    it('edits patterns and tags without touching official topics, and prunes stale indexes', async () => {
      const res = await authed(token)
        .patch('/api/v1/problems/two-sum')
        .send({
          patterns: ['Hashing', 'Two Pointers'],
          customTags: ['Google', 'Must Revise'],
          timeComplexity: 'O(n)',
        });
      expect(res.status).toBe(200);
      expect(res.body.sync.outcome).toBe('committed');
      expect(res.body.problem.topics.map((t: { name: string }) => t.name)).toEqual([
        'Array',
        'Hash Table',
      ]);
      expect(res.body.problem.customTags).toEqual(['Google', 'Must Revise']);
      expect(ctx.github.log(repoId)[0]).toBe('leetcode: update #1 Two Sum');

      let files = ctx.github.files(repoId);
      expect(files.get('patterns/two-pointers.md')).toContain('0001-two-sum');
      const meta = JSON.parse(files.get('problems/0001-two-sum/metadata.json')!);
      expect(meta).toMatchObject({
        topics: ['Array', 'Hash Table'],
        customTags: ['Google', 'Must Revise'],
      });
      expect(files.get('problems/0001-two-sum/README.md')).toContain('- Time: O(n)');

      await authed(token)
        .patch('/api/v1/problems/two-sum')
        .send({ patterns: ['Hashing'] });
      files = ctx.github.files(repoId);
      expect(files.has('patterns/two-pointers.md')).toBe(false);

      const tags = await authed(token).get('/api/v1/tags');
      expect(tags.body.items.map((t: { name: string }) => t.name)).toEqual([
        'Google',
        'Must Revise',
      ]);
      const tagged = await authed(token).get('/api/v1/problems').query({ q: 'google' });
      expect(tagged.body.items).toHaveLength(1);
    });

    it('keeps edits when GitHub is unavailable and reports the sync error', async () => {
      const { AppError } = await import('../src/common/app-error.js');
      ctx.github.failNext(
        'createTree',
        () => new AppError('GITHUB_UNAVAILABLE', 'GitHub is temporarily unavailable.'),
      );
      const res = await authed(token)
        .patch('/api/v1/problems/two-sum')
        .send({ status: 'difficult' });
      expect(res.status).toBe(200);
      expect(res.body.problem.status).toBe('difficult');
      expect(res.body.syncError.code).toBe('GITHUB_UNAVAILABLE');
      const stats = await authed(token).get('/api/v1/stats');
      expect(stats.body.pendingCommitCount).toBe(1);
    });

    it('records manual revisions and computes due problems', async () => {
      const rev = await authed(token)
        .post('/api/v1/revisions')
        .send({ problemSlug: 'two-sum', notes: 'Easy now' });
      expect(rev.status).toBe(201);
      expect(rev.body.problem).toMatchObject({ revisionCount: 2, status: 'revised' });
      expect(rev.body.sync).toBeNull(); // activity metadata does not commit by default

      expect((await authed(token).get('/api/v1/revisions/due')).body.items).toEqual([]);
      await authed(token).patch('/api/v1/problems/word-search').send({ status: 'need_revision' });
      const due = await authed(token).get('/api/v1/revisions/due');
      expect(due.body.items.map((p: { slug: string }) => p.slug)).toEqual(['word-search']);
      ctx.clock.advanceHours(24 * 15);
      expect((await authed(token).get('/api/v1/revisions/due')).body.items).toHaveLength(2);
    });

    it('saves an attempt into the attempts folder on request', async () => {
      const detail = await authed(token).get('/api/v1/problems/two-sum');
      const sub = detail.body.submissions[0];
      const res = await authed(token).post('/api/v1/problems/two-sum/attempts').send({
        leetcodeSubmissionId: sub.leetcodeSubmissionId,
        kind: 'new_approach',
        note: 'hash map',
      });
      expect(res.status).toBe(201);
      expect(ctx.github.log(repoId)[0]).toBe('leetcode: save attempt for #1 Two Sum (Python)');
      const files = ctx.github.files(repoId);
      expect(files.has('problems/0001-two-sum/attempts/2026-10-07-python.py')).toBe(true);
      expect(files.get('problems/0001-two-sum/README.md')).toContain('New approach — hash map');
    });

    it('returns dashboard statistics', async () => {
      const stats = await authed(token).get('/api/v1/stats');
      expect(stats.body).toMatchObject({
        total: 2,
        easy: 1,
        medium: 1,
        hard: 0,
        pendingCommitCount: 0,
      });
      expect(stats.body.topics[0]).toMatchObject({ name: 'Array', count: 2, easy: 1, medium: 1 });
      expect(stats.body.languages.map((l: { slug: string }) => l.slug).sort()).toEqual([
        'java',
        'python3',
      ]);
      expect(stats.body.recentSyncs[0]).toMatchObject({
        kind: 'submission',
        status: 'succeeded',
        outcome: 'committed',
      });
    });

    it('rebuilds the repository with a full sync', async () => {
      ctx.github.pushFile(repoId, 'main', 'topics/stale-topic.md', 'stale');
      const res = await authed(token).post('/api/v1/sync/full');
      expect(res.body.outcome).toBe('committed');
      expect(ctx.github.log(repoId)[0]).toBe('leetcode: sync 2 problems');
      expect(ctx.github.files(repoId).has('topics/stale-topic.md')).toBe(false);
      const again = await authed(token).post('/api/v1/sync/full');
      expect(again.body.outcome).toBe('up_to_date');
    });
  });

  describe('validation', () => {
    it('returns structured validation errors', async () => {
      const { sessionToken } = await loginViaHttp(ctx);
      const req = submission();
      const res = await authed(sessionToken)
        .post('/api/v1/sync/problem')
        .send({ ...req, submission: { ...req.submission, code: undefined } });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        retryable: false,
        message: 'Invalid request: submission.code: Accepted submissions must include code',
      });
    });

    it('rejects malformed JSON', async () => {
      const { sessionToken } = await loginViaHttp(ctx);
      const res = await authed(sessionToken)
        .post('/api/v1/sync/problem')
        .set('Content-Type', 'application/json')
        .send('{nope');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
