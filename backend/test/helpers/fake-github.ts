/**
 * In-memory GitHub implementing GitHubApi with content-addressed blobs/trees/commits, so tree
 * equality (the basis of "no changes → no commit") behaves like real Git.
 */
import { createHash } from 'node:crypto';
import type { BranchDto } from '@lcsync/shared';
import { AppError } from '../../src/common/app-error.js';
import type {
  BranchHead,
  GitHubApi,
  GitHubRepository,
  GitHubUser,
  RepoRef,
  TreeChange,
  TreeEntry,
} from '../../src/modules/github/github-api.js';
import type { GitHubOAuthClient, OAuthTokenResult } from '../../src/modules/github/github-oauth.js';

type Entry = { type: 'blob' | 'tree'; sha: string };

interface FakeRepo {
  id: number;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  /** Logins with push access. */
  writers: Set<string>;
  branches: Map<string, string>;
}

interface Commit {
  tree: string;
  parents: string[];
  message: string;
}

interface TokenInfo {
  user: GitHubUser;
  scopes: string[];
  revoked: boolean;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

export class FakeGitHub {
  readonly blobs = new Map<string, string>();
  readonly trees = new Map<string, Map<string, Entry>>();
  readonly commits = new Map<string, Commit>();
  readonly repos = new Map<number, FakeRepo>();
  readonly tokens = new Map<string, TokenInfo>();
  /** Counts API calls per method, for asserting how much work a sync did. */
  readonly calls = new Map<string, number>();
  private nextRepoId = 1000;
  private failures: { method: keyof GitHubApi; error: () => Error; times: number }[] = [];
  /** Runs right before a branch update (simulate someone else pushing). */
  beforeUpdateBranch: ((repoId: number, branch: string) => void) | null = null;

  readonly emptyTree: string;

  constructor() {
    this.emptyTree = this.storeTree(new Map());
  }

  // ---------------------------------------------------------------- setup helpers

  addToken(token: string, user: GitHubUser, scopes: string[] = ['repo']): void {
    this.tokens.set(token, { user, scopes, revoked: false });
  }

  revokeToken(token: string): void {
    const t = this.tokens.get(token);
    if (t) t.revoked = true;
  }

  createRepo(
    owner: string,
    name: string,
    opts: {
      private?: boolean;
      empty?: boolean;
      defaultBranch?: string;
      files?: Record<string, string>;
    } = {},
  ): FakeRepo {
    const repo: FakeRepo = {
      id: this.nextRepoId++,
      owner,
      name,
      private: opts.private ?? false,
      defaultBranch: opts.defaultBranch ?? 'main',
      writers: new Set([owner]),
      branches: new Map(),
    };
    if (!opts.empty) {
      let tree = this.emptyTree;
      for (const [path, content] of Object.entries(opts.files ?? { 'README.md': `# ${name}\n` })) {
        tree = this.applyChange(tree, path.split('/'), { path, content });
      }
      repo.branches.set(
        repo.defaultBranch,
        this.storeCommit({ tree, parents: [], message: 'Initial commit' }),
      );
    }
    this.repos.set(repo.id, repo);
    return repo;
  }

  failNext(method: keyof GitHubApi, error: () => Error, times = 1): void {
    this.failures.push({ method, error, times });
  }

  /** Flattened files on a branch: path → content. */
  files(repoId: number, branch = 'main'): Map<string, string> {
    const repo = this.repo(repoId);
    const head = repo.branches.get(branch);
    const out = new Map<string, string>();
    if (!head) return out;
    const walk = (treeSha: string, prefix: string) => {
      for (const [name, e] of this.trees.get(treeSha)!) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (e.type === 'tree') walk(e.sha, path);
        else out.set(path, this.blobs.get(e.sha)!);
      }
    };
    walk(this.commits.get(head)!.tree, '');
    return out;
  }

  /** Commit messages on a branch, newest first. */
  log(repoId: number, branch = 'main'): string[] {
    const messages: string[] = [];
    let sha = this.repo(repoId).branches.get(branch);
    while (sha) {
      const c = this.commits.get(sha)!;
      messages.push(c.message);
      sha = c.parents[0];
    }
    return messages;
  }

  /** Push a commit directly (as if from another machine). */
  pushFile(
    repoId: number,
    branch: string,
    path: string,
    content: string,
    message = 'external change',
  ): void {
    const repo = this.repo(repoId);
    const head = repo.branches.get(branch)!;
    const tree = this.applyChange(this.commits.get(head)!.tree, path.split('/'), { path, content });
    repo.branches.set(branch, this.storeCommit({ tree, parents: [head], message }));
  }

  api(token: string): GitHubApi {
    return new FakeGitHubApi(this, token);
  }

  // ---------------------------------------------------------------- internals used by the API

  count(method: string): void {
    this.calls.set(method, (this.calls.get(method) ?? 0) + 1);
  }

  maybeFail(method: keyof GitHubApi): void {
    const f = this.failures.find((x) => x.method === method && x.times > 0);
    if (f) {
      f.times--;
      throw f.error();
    }
  }

  repo(id: number): FakeRepo {
    const r = this.repos.get(id);
    if (!r) throw new Error(`no repo ${id}`);
    return r;
  }

  findRepo(ref: RepoRef): FakeRepo | undefined {
    return [...this.repos.values()].find((r) => r.owner === ref.owner && r.name === ref.repo);
  }

  storeTree(entries: Map<string, Entry>): string {
    const sorted = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
    const sha = sha1('tree' + JSON.stringify(sorted));
    this.trees.set(sha, new Map(sorted));
    return sha;
  }

  storeBlob(content: string): string {
    const sha = sha1('blob' + content);
    this.blobs.set(sha, content);
    return sha;
  }

  storeCommit(c: Commit): string {
    const sha = sha1('commit' + JSON.stringify(c) + Math.random());
    this.commits.set(sha, c);
    return sha;
  }

  applyChange(treeSha: string, segments: string[], change: TreeChange): string {
    const entries = new Map(this.trees.get(treeSha) ?? []);
    const [head, ...rest] = segments as [string, ...string[]];
    if (rest.length === 0) {
      if ('delete' in change) entries.delete(head);
      else entries.set(head, { type: 'blob', sha: this.storeBlob(change.content) });
    } else {
      const existing = entries.get(head);
      const child = this.applyChange(
        existing?.type === 'tree' ? existing.sha : this.emptyTree,
        rest,
        change,
      );
      if (child === this.emptyTree) entries.delete(head);
      else entries.set(head, { type: 'tree', sha: child });
    }
    return this.storeTree(entries);
  }
}

class FakeGitHubApi implements GitHubApi {
  constructor(
    private readonly gh: FakeGitHub,
    private readonly token: string,
  ) {}

  private auth(method: keyof GitHubApi): TokenInfo {
    this.gh.count(method);
    const t = this.gh.tokens.get(this.token);
    if (!t || t.revoked) {
      throw new AppError(
        'GITHUB_AUTH_EXPIRED',
        'GitHub authorization has expired. Please reconnect GitHub.',
      );
    }
    this.gh.maybeFail(method);
    return t;
  }

  private visible(t: TokenInfo, repo: FakeRepo | undefined): FakeRepo {
    if (!repo || (repo.private && !t.scopes.includes('repo'))) {
      throw new AppError('GITHUB_REPO_NOT_FOUND', 'Repository not found.');
    }
    return repo;
  }

  private toDto(t: TokenInfo, r: FakeRepo): GitHubRepository {
    return {
      id: r.id,
      owner: r.owner,
      name: r.name,
      fullName: `${r.owner}/${r.name}`,
      private: r.private,
      defaultBranch: r.defaultBranch,
      htmlUrl: `https://github.com/${r.owner}/${r.name}`,
      canPush: r.writers.has(t.user.login),
    };
  }

  private writable(t: TokenInfo, ref: RepoRef): FakeRepo {
    const repo = this.visible(t, this.gh.findRepo(ref));
    if (!repo.writers.has(t.user.login)) throw new AppError('GITHUB_PERMISSION_DENIED', 'denied');
    return repo;
  }

  async getAuthenticatedUser(): Promise<GitHubUser> {
    return this.auth('getAuthenticatedUser').user;
  }

  async listRepositories(): Promise<GitHubRepository[]> {
    const t = this.auth('listRepositories');
    return [...this.gh.repos.values()]
      .filter((r) => (!r.private || t.scopes.includes('repo')) && r.writers.has(t.user.login))
      .map((r) => this.toDto(t, r));
  }

  async getRepositoryById(id: number): Promise<GitHubRepository> {
    const t = this.auth('getRepositoryById');
    return this.toDto(t, this.visible(t, this.gh.repos.get(id)));
  }

  async createRepository(input: { name: string; private: boolean }): Promise<GitHubRepository> {
    const t = this.auth('createRepository');
    if (this.gh.findRepo({ owner: t.user.login, repo: input.name })) {
      throw new AppError(
        'CONFLICT',
        `A repository named "${input.name}" already exists on your account.`,
      );
    }
    return this.toDto(t, this.gh.createRepo(t.user.login, input.name, { private: input.private }));
  }

  async listBranches(ref: RepoRef): Promise<BranchDto[]> {
    const t = this.auth('listBranches');
    const repo = this.visible(t, this.gh.findRepo(ref));
    return [...repo.branches.keys()].map((name) => ({ name, protected: false }));
  }

  async getBranchHead(ref: RepoRef, branch: string): Promise<BranchHead> {
    const t = this.auth('getBranchHead');
    const repo = this.visible(t, this.gh.findRepo(ref));
    if (repo.branches.size === 0) return { state: 'empty' };
    const sha = repo.branches.get(branch);
    return sha ? { state: 'ok', commitSha: sha } : { state: 'missing' };
  }

  async getCommitTreeSha(_ref: RepoRef, commitSha: string): Promise<string> {
    this.auth('getCommitTreeSha');
    return this.gh.commits.get(commitSha)!.tree;
  }

  async listTree(_ref: RepoRef, treeSha: string): Promise<TreeEntry[]> {
    this.auth('listTree');
    return [...(this.gh.trees.get(treeSha) ?? new Map<string, Entry>()).entries()].map(
      ([path, e]) => ({
        path,
        type: e.type,
        sha: e.sha,
      }),
    );
  }

  async getFileContent(_ref: RepoRef, path: string, commitSha: string): Promise<string | null> {
    this.auth('getFileContent');
    let tree = this.gh.commits.get(commitSha)!.tree;
    const segments = path.split('/');
    for (const [i, seg] of segments.entries()) {
      const e = this.gh.trees.get(tree)?.get(seg);
      if (!e) return null;
      if (i === segments.length - 1) return e.type === 'blob' ? this.gh.blobs.get(e.sha)! : null;
      tree = e.sha;
    }
    return null;
  }

  async createTree(ref: RepoRef, baseTreeSha: string, changes: TreeChange[]): Promise<string> {
    const t = this.auth('createTree');
    this.writable(t, ref);
    let tree = baseTreeSha;
    for (const c of changes) tree = this.gh.applyChange(tree, c.path.split('/'), c);
    return tree;
  }

  async createCommit(
    ref: RepoRef,
    message: string,
    treeSha: string,
    parentShas: string[],
  ): Promise<string> {
    const t = this.auth('createCommit');
    this.writable(t, ref);
    return this.gh.storeCommit({ tree: treeSha, parents: parentShas, message });
  }

  async updateBranch(ref: RepoRef, branch: string, commitSha: string): Promise<boolean> {
    const t = this.auth('updateBranch');
    const repo = this.writable(t, ref);
    this.gh.beforeUpdateBranch?.(repo.id, branch);
    const head = repo.branches.get(branch);
    if (!head) throw new AppError('GITHUB_BRANCH_NOT_FOUND', 'missing');
    if (!this.gh.commits.get(commitSha)!.parents.includes(head)) return false;
    repo.branches.set(branch, commitSha);
    return true;
  }

  async createFile(ref: RepoRef, path: string, content: string, message: string): Promise<void> {
    const t = this.auth('createFile');
    const repo = this.writable(t, ref);
    const head = repo.branches.get(repo.defaultBranch);
    const base = head ? this.gh.commits.get(head)!.tree : this.gh.emptyTree;
    const tree = this.gh.applyChange(base, path.split('/'), { path, content });
    repo.branches.set(
      repo.defaultBranch,
      this.gh.storeCommit({ tree, parents: head ? [head] : [], message }),
    );
  }
}

/** OAuth client fake: codes registered by the test map to tokens. */
export class FakeOAuth implements GitHubOAuthClient {
  readonly codes = new Map<string, OAuthTokenResult>();
  readonly revoked: string[] = [];

  authorizeUrl({
    state,
    scope,
    redirectUri,
  }: {
    state: string;
    scope: string;
    redirectUri: string;
  }): string {
    const url = new URL('https://github.test/login/oauth/authorize');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', scope);
    url.searchParams.set('redirect_uri', redirectUri);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<OAuthTokenResult> {
    const result = this.codes.get(code);
    if (!result)
      throw new AppError('GITHUB_AUTH_FAILED', 'GitHub sign-in failed. Please try again.');
    this.codes.delete(code);
    return result;
  }

  async revokeGrant(accessToken: string): Promise<void> {
    this.revoked.push(accessToken);
  }
}
