import { describe, expect, it } from 'vitest';
import { commitFiles } from '../src/modules/github/git-committer.js';
import { FakeGitHub } from './helpers/fake-github.js';

function setup(opts: Parameters<FakeGitHub['createRepo']>[2] = {}) {
  const gh = new FakeGitHub();
  gh.addToken('t', { id: 1, login: 'me', avatarUrl: null });
  const repo = gh.createRepo('me', 'r', opts);
  return { gh, repo, api: gh.api('t'), ref: { owner: 'me', repo: 'r' } };
}

describe('commitFiles', () => {
  it('writes many files as a single commit', async () => {
    const { gh, repo, api, ref } = setup();
    const res = await commitFiles(api, {
      ref,
      branch: 'main',
      message: 'leetcode: add #1 Two Sum',
      writes: [
        { path: 'problems/0001-two-sum/README.md', content: 'a' },
        { path: 'topics/array.md', content: 'b' },
      ],
    });
    expect(res.commitSha).toBeTruthy();
    expect(gh.log(repo.id)).toEqual(['leetcode: add #1 Two Sum', 'Initial commit']);
    expect(gh.files(repo.id).get('topics/array.md')).toBe('b');
  });

  it('creates no commit when nothing changed', async () => {
    const { gh, repo, api, ref } = setup();
    const req = { ref, branch: 'main', message: 'm', writes: [{ path: 'a.md', content: 'x' }] };
    await commitFiles(api, req);
    const second = await commitFiles(api, req);
    expect(second.commitSha).toBeNull();
    expect(gh.log(repo.id)).toHaveLength(2);
  });

  it('deletes stale files only inside owned directories', async () => {
    const { gh, repo, api, ref } = setup({
      files: {
        'topics/old.md': 'old',
        'topics/keep.md': 'k',
        'topics/image.png': 'png',
        'notes/x.md': 'mine',
      },
    });
    await commitFiles(api, {
      ref,
      branch: 'main',
      message: 'm',
      writes: [{ path: 'topics/keep.md', content: 'k2' }],
      ownedDirs: ['topics', 'patterns'],
    });
    const files = gh.files(repo.id);
    expect(files.has('topics/old.md')).toBe(false);
    expect(files.get('topics/keep.md')).toBe('k2');
    expect(files.has('topics/image.png')).toBe(true); // not a generated file type
    expect(files.get('notes/x.md')).toBe('mine');
  });

  it('merges a file with its current content', async () => {
    const { gh, repo, api, ref } = setup({ files: { 'README.md': 'hello' } });
    await commitFiles(api, {
      ref,
      branch: 'main',
      message: 'm',
      writes: [],
      merges: [{ path: 'README.md', merge: (existing) => `${existing} world` }],
    });
    expect(gh.files(repo.id).get('README.md')).toBe('hello world');
  });

  it('bootstraps an empty repository', async () => {
    const { gh, repo, api, ref } = setup({ empty: true });
    await commitFiles(api, {
      ref,
      branch: 'main',
      message: 'leetcode: add #1 Two Sum',
      writes: [{ path: 'problems/x/README.md', content: 'x' }],
      merges: [{ path: 'README.md', merge: () => '# LeetCode Solutions\n' }],
    });
    expect(gh.log(repo.id)).toEqual([
      'leetcode: add #1 Two Sum',
      'leetcode: initialize repository',
    ]);
    expect(gh.files(repo.id).get('problems/x/README.md')).toBe('x');
  });

  it('reports a missing branch clearly', async () => {
    const { api, ref } = setup();
    await expect(
      commitFiles(api, {
        ref,
        branch: 'nope',
        message: 'm',
        writes: [{ path: 'a', content: 'b' }],
      }),
    ).rejects.toMatchObject({
      code: 'GITHUB_BRANCH_NOT_FOUND',
      message: expect.stringContaining('"nope"'),
    });
  });

  it('gives up with a retryable conflict if the branch keeps moving', async () => {
    const { gh, api, ref } = setup();
    let n = 0;
    gh.beforeUpdateBranch = (id, branch) => gh.pushFile(id, branch, `x${n++}.md`, 'x');
    await expect(
      commitFiles(api, {
        ref,
        branch: 'main',
        message: 'm',
        writes: [{ path: 'a.md', content: 'b' }],
      }),
    ).rejects.toMatchObject({ code: 'GITHUB_CONFLICT', retryable: true });
  });
});
