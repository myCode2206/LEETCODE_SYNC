import type { BranchDto } from '@lcsync/shared';
import { AppError } from '../../common/app-error.js';
import type {
  BranchHead,
  GitHubApi,
  GitHubRepository,
  GitHubUser,
  RepoRef,
  TreeChange,
  TreeEntry,
} from './github-api.js';
import { networkError, toGitHubError } from './github-errors.js';
import type { GitHubErrorContext } from './github-errors.js';

const API_BASE = 'https://api.github.com';
const TIMEOUT_MS = 20_000;
const MAX_PAGES = 10;
/** Keep each create-tree request comfortably below GitHub's payload limits. */
export const TREE_CHUNK_SIZE = 250;

interface RawRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  owner: { login: string };
  permissions?: { push?: boolean; admin?: boolean };
}

interface RequestOptions {
  body?: unknown;
  context?: GitHubErrorContext;
  /** Statuses returned to the caller instead of being thrown. */
  allow?: number[];
}

interface Response<T> {
  status: number;
  data: T;
  headers: Headers;
}

function mapRepository(raw: RawRepository): GitHubRepository {
  return {
    id: raw.id,
    owner: raw.owner.login,
    name: raw.name,
    fullName: raw.full_name,
    private: raw.private,
    defaultBranch: raw.default_branch,
    htmlUrl: raw.html_url,
    canPush: Boolean(raw.permissions?.push || raw.permissions?.admin),
  };
}

function repoPath({ owner, repo }: RepoRef): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function nextPageUrl(headers: Headers): string | null {
  const link = headers.get('link');
  const match = link?.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

/** GitHub REST client using the user's OAuth token. Never logs or returns the token. */
export class GitHubHttpApi implements GitHubApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(
    method: string,
    pathOrUrl: string,
    options: RequestOptions = {},
  ): Promise<Response<T>> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    let res: globalThis.Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'leetcode-github-sync',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw networkError(err);
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (res.ok || options.allow?.includes(res.status)) {
      return { status: res.status, data: data as T, headers: res.headers };
    }
    throw toGitHubError(
      { status: res.status, headers: res.headers, body: data },
      options.context ?? { kind: 'generic' },
    );
  }

  private async paginate<T>(path: string, context?: GitHubErrorContext): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = path;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res: Response<T[]> = await this.request<T[]>('GET', url, { context });
      out.push(...res.data);
      url = nextPageUrl(res.headers);
    }
    return out;
  }

  async getAuthenticatedUser(): Promise<GitHubUser> {
    const { data } = await this.request<{ id: number; login: string; avatar_url?: string }>(
      'GET',
      '/user',
    );
    return { id: data.id, login: data.login, avatarUrl: data.avatar_url ?? null };
  }

  async listRepositories(): Promise<GitHubRepository[]> {
    const raw = await this.paginate<RawRepository>(
      '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
    );
    return raw.map(mapRepository);
  }

  async getRepositoryById(id: number): Promise<GitHubRepository> {
    const { data } = await this.request<RawRepository>('GET', `/repositories/${id}`, {
      context: { kind: 'repository' },
    });
    return mapRepository(data);
  }

  async createRepository(input: {
    name: string;
    private: boolean;
    description?: string;
  }): Promise<GitHubRepository> {
    const res = await this.request<RawRepository & { message?: string }>('POST', '/user/repos', {
      body: {
        name: input.name,
        private: input.private,
        description: input.description,
        auto_init: true,
      },
      allow: [422],
    });
    if (res.status === 422) {
      throw new AppError(
        'CONFLICT',
        `A repository named "${input.name}" already exists on your account.`,
      );
    }
    return mapRepository(res.data);
  }

  async listBranches(ref: RepoRef): Promise<BranchDto[]> {
    const raw = await this.paginate<{ name: string; protected: boolean }>(
      `${repoPath(ref)}/branches?per_page=100`,
      {
        kind: 'repository',
        fullName: `${ref.owner}/${ref.repo}`,
      },
    );
    return raw.map((b) => ({ name: b.name, protected: b.protected }));
  }

  async getBranchHead(ref: RepoRef, branch: string): Promise<BranchHead> {
    const res = await this.request<{ object?: { sha: string } }>(
      'GET',
      `${repoPath(ref)}/git/ref/heads/${encodePath(branch)}`,
      {
        allow: [404, 409],
        context: { kind: 'branch', fullName: `${ref.owner}/${ref.repo}`, branch },
      },
    );
    if (res.status === 409) return { state: 'empty' };
    if (res.status === 404 || !res.data?.object?.sha) return { state: 'missing' };
    return { state: 'ok', commitSha: res.data.object.sha };
  }

  async getCommitTreeSha(ref: RepoRef, commitSha: string): Promise<string> {
    const { data } = await this.request<{ tree: { sha: string } }>(
      'GET',
      `${repoPath(ref)}/git/commits/${commitSha}`,
    );
    return data.tree.sha;
  }

  async listTree(ref: RepoRef, treeSha: string): Promise<TreeEntry[]> {
    const { data } = await this.request<{ tree: TreeEntry[] }>(
      'GET',
      `${repoPath(ref)}/git/trees/${treeSha}`,
    );
    return data.tree.map((e) => ({ path: e.path, type: e.type, sha: e.sha }));
  }

  async getFileContent(ref: RepoRef, path: string, commitSha: string): Promise<string | null> {
    const res = await this.request<{ content?: string; encoding?: string; type?: string }>(
      'GET',
      `${repoPath(ref)}/contents/${encodePath(path)}?ref=${commitSha}`,
      { allow: [404] },
    );
    if (res.status === 404 || res.data?.type !== 'file' || typeof res.data.content !== 'string')
      return null;
    return Buffer.from(res.data.content, 'base64').toString('utf8');
  }

  async createTree(ref: RepoRef, baseTreeSha: string, changes: TreeChange[]): Promise<string> {
    let base = baseTreeSha;
    for (let i = 0; i < changes.length; i += TREE_CHUNK_SIZE) {
      const chunk = changes.slice(i, i + TREE_CHUNK_SIZE);
      const { data } = await this.request<{ sha: string }>('POST', `${repoPath(ref)}/git/trees`, {
        body: {
          base_tree: base,
          tree: chunk.map((c) =>
            'delete' in c
              ? { path: c.path, mode: '100644', type: 'blob', sha: null }
              : { path: c.path, mode: '100644', type: 'blob', content: c.content },
          ),
        },
      });
      base = data.sha;
    }
    return base;
  }

  async createCommit(
    ref: RepoRef,
    message: string,
    treeSha: string,
    parentShas: string[],
  ): Promise<string> {
    const { data } = await this.request<{ sha: string }>('POST', `${repoPath(ref)}/git/commits`, {
      body: { message, tree: treeSha, parents: parentShas },
    });
    return data.sha;
  }

  async updateBranch(ref: RepoRef, branch: string, commitSha: string): Promise<boolean> {
    const res = await this.request<unknown>(
      'PATCH',
      `${repoPath(ref)}/git/refs/heads/${encodePath(branch)}`,
      {
        body: { sha: commitSha, force: false },
        allow: [422],
        context: { kind: 'branch', fullName: `${ref.owner}/${ref.repo}`, branch },
      },
    );
    return res.status !== 422;
  }

  async createFile(ref: RepoRef, path: string, content: string, message: string): Promise<void> {
    await this.request('PUT', `${repoPath(ref)}/contents/${encodePath(path)}`, {
      body: { message, content: Buffer.from(content, 'utf8').toString('base64') },
      context: { kind: 'repository', fullName: `${ref.owner}/${ref.repo}` },
    });
  }
}
