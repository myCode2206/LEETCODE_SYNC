import { describe, expect, it } from 'vitest';
import { GitHubHttpApi } from '../src/modules/github/github-http-api.js';

function mockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): typeof fetch {
  return (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })) as typeof fetch;
}

const ref = { owner: 'me', repo: 'r' };

describe('GitHubHttpApi error translation', () => {
  it('maps 401 to an actionable re-auth message', async () => {
    const api = new GitHubHttpApi('t', mockFetch(401, { message: 'Bad credentials' }));
    await expect(api.getAuthenticatedUser()).rejects.toMatchObject({
      code: 'GITHUB_AUTH_EXPIRED',
      message: 'GitHub authorization has expired. Please reconnect GitHub.',
      status: 401,
    });
  });

  it('maps primary rate limits with the reset time', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const api = new GitHubHttpApi(
      't',
      mockFetch(
        403,
        { message: 'API rate limit exceeded' },
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      ),
    );
    const err = await api.listRepositories().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'GITHUB_RATE_LIMITED', retryable: true });
    expect((err as { retryAt: Date }).retryAt.getTime()).toBe(reset * 1000);
  });

  it('maps secondary rate limits using retry-after', async () => {
    const api = new GitHubHttpApi(
      't',
      mockFetch(429, { message: 'slow down' }, { 'retry-after': '30' }),
    );
    await expect(api.listRepositories()).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED' });
  });

  it('explains a missing repository', async () => {
    const api = new GitHubHttpApi('t', mockFetch(404, { message: 'Not Found' }));
    await expect(api.getRepositoryById(5)).rejects.toMatchObject({
      code: 'GITHUB_REPO_NOT_FOUND',
      message: expect.stringContaining('deleted, renamed, or made private'),
    });
  });

  it('maps 403 without rate limit to a permission error', async () => {
    const api = new GitHubHttpApi('t', mockFetch(403, { message: 'Resource not accessible' }));
    await expect(api.createCommit(ref, 'm', 'tree', [])).rejects.toMatchObject({
      code: 'GITHUB_PERMISSION_DENIED',
    });
  });

  it('maps 5xx and network failures to a retryable error', async () => {
    await expect(
      new GitHubHttpApi('t', mockFetch(502, {})).getAuthenticatedUser(),
    ).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
      retryable: true,
    });
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(new GitHubHttpApi('t', failing).getAuthenticatedUser()).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
  });

  it('reports branch states', async () => {
    expect(
      await new GitHubHttpApi(
        't',
        mockFetch(409, { message: 'Git Repository is empty.' }),
      ).getBranchHead(ref, 'main'),
    ).toEqual({
      state: 'empty',
    });
    expect(
      await new GitHubHttpApi('t', mockFetch(404, { message: 'Not Found' })).getBranchHead(
        ref,
        'x',
      ),
    ).toEqual({
      state: 'missing',
    });
    expect(
      await new GitHubHttpApi('t', mockFetch(200, { object: { sha: 'abc' } })).getBranchHead(
        ref,
        'main',
      ),
    ).toEqual({ state: 'ok', commitSha: 'abc' });
  });

  it('treats a non-fast-forward ref update as "branch moved"', async () => {
    const api = new GitHubHttpApi('t', mockFetch(422, { message: 'Update is not a fast forward' }));
    expect(await api.updateBranch(ref, 'main', 'sha')).toBe(false);
  });

  it('never leaks the token in errors', async () => {
    const api = new GitHubHttpApi('secret-token-value', mockFetch(500, {}));
    const err = await api.getAuthenticatedUser().catch((e: Error) => e);
    expect(JSON.stringify(err)).not.toContain('secret-token-value');
    expect((err as Error).message).not.toContain('secret-token-value');
  });

  it('sends the documented headers and paginates', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization') });
      const page2 = 'https://api.github.com/user/repos?page=2';
      const repo = (id: number) => ({
        id,
        name: `r${id}`,
        full_name: `me/r${id}`,
        private: id === 2,
        default_branch: 'main',
        html_url: '',
        owner: { login: 'me' },
        permissions: { push: true },
      });
      return url === page2
        ? new Response(JSON.stringify([repo(2)]), { status: 200 })
        : new Response(JSON.stringify([repo(1)]), {
            status: 200,
            headers: { link: `<${page2}>; rel="next"` },
          });
    }) as unknown as typeof fetch;
    const repos = await new GitHubHttpApi('tok', fetchImpl).listRepositories();
    expect(repos.map((r) => [r.id, r.private, r.canPush])).toEqual([
      [1, false, true],
      [2, true, true],
    ]);
    expect(seen[0]!.auth).toBe('Bearer tok');
  });
});
