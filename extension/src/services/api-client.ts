import { API_PREFIX } from '@lcsync/shared';
import type {
  ApiErrorBody,
  BranchDto,
  CategoryCountDto,
  CreateRepositoryInput,
  CreateRevisionInput,
  ErrorCode,
  GitHubRepoDto,
  MeDto,
  ProblemDetailDto,
  ProblemListQuery,
  ProblemSummaryDto,
  RepositoryConfigDto,
  RepositoryConfigInput,
  RepositorySettings,
  SaveAttemptInput,
  SessionDto,
  StatsDto,
  SyncJobDto,
  SyncProblemRequestInput,
  SyncResultDto,
  UpdateProblemInput,
} from '@lcsync/shared';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

/** Backend error codes plus client-side ones. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAt: Date | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface MutationResult {
  problem: ProblemDetailDto;
  sync: SyncResultDto | null;
  syncError: { code: ErrorCode; message: string } | null;
}

/** Typed client for the backend REST API (/api/v1). */
export class ApiClient {
  constructor(
    private readonly getToken: () => Promise<string | null>,
    readonly baseUrl: string = API_BASE_URL,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${API_PREFIX}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const token = await this.getToken();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new ApiError('NETWORK_ERROR', 'The sync server did not respond in time.', 0, true);
      }
      throw new ApiError(
        'NETWORK_ERROR',
        'Cannot reach the sync server. Check your connection; pending syncs are kept.',
        0,
        true,
      );
    }
    if (res.status === 204) return undefined as T;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data as ApiErrorBody | null)?.error;
      if (err) {
        throw new ApiError(
          err.code,
          err.message,
          res.status,
          err.retryable,
          err.retryAt ? new Date(err.retryAt) : null,
        );
      }
      throw new ApiError(
        'INTERNAL',
        `Unexpected server response (${res.status}).`,
        res.status,
        res.status >= 500,
      );
    }
    return data as T;
  }

  loginUrl(redirectUri: string, access: 'public' | 'private'): string {
    const url = new URL(`${this.baseUrl}${API_PREFIX}/auth/github`);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('access', access);
    return url.toString();
  }

  /** Side-effect-free check that the server is up and will accept `redirectUri` for sign-in. */
  checkLogin = (redirectUri: string, access: 'public' | 'private') =>
    this.request<void>(
      'GET',
      '/auth/github/check',
      undefined,
      { redirect_uri: redirectUri, access },
      8_000,
    );
  exchangeCode = (code: string) => this.request<SessionDto>('POST', '/auth/token', { code });
  me = () => this.request<MeDto>('GET', '/auth/me');
  logout = () => this.request<void>('POST', '/auth/logout');
  disconnectGitHub = () => this.request<void>('DELETE', '/auth/github');

  listRepositories = () =>
    this.request<{ items: GitHubRepoDto[] }>('GET', '/github/repositories').then((r) => r.items);
  createRepository = (input: CreateRepositoryInput) =>
    this.request<GitHubRepoDto>('POST', '/github/repositories', input);
  listBranches = (githubRepoId: number) =>
    this.request<{ items: BranchDto[] }>(
      'GET',
      `/github/repositories/${githubRepoId}/branches`,
    ).then((r) => r.items);

  getRepository = () =>
    this.request<{ repository: RepositoryConfigDto | null }>('GET', '/repository').then(
      (r) => r.repository,
    );
  configureRepository = (input: RepositoryConfigInput) =>
    this.request<{ repository: RepositoryConfigDto }>('PUT', '/repository', input).then(
      (r) => r.repository,
    );
  updateRepositorySettings = (settings: Partial<RepositorySettings>) =>
    this.request<{ repository: RepositoryConfigDto }>(
      'PATCH',
      '/repository/settings',
      settings,
    ).then((r) => r.repository);

  syncProblem = (input: SyncProblemRequestInput) =>
    this.request<SyncResultDto>('POST', '/sync/problem', input);
  pushPending = () => this.request<SyncResultDto>('POST', '/sync/pending');
  fullSync = () => this.request<SyncResultDto>('POST', '/sync/full');
  listJobs = (limit = 20) =>
    this.request<{ items: SyncJobDto[] }>('GET', '/sync/jobs', undefined, { limit }).then(
      (r) => r.items,
    );

  listProblems = (query: Partial<Record<keyof ProblemListQuery, string>> = {}) =>
    this.request<{ items: ProblemSummaryDto[] }>('GET', '/problems', undefined, query).then(
      (r) => r.items,
    );
  getProblem = (slug: string) =>
    this.request<ProblemDetailDto>('GET', `/problems/${encodeURIComponent(slug)}`);
  updateProblem = (slug: string, input: UpdateProblemInput) =>
    this.request<MutationResult>('PATCH', `/problems/${encodeURIComponent(slug)}`, input);
  saveAttempt = (slug: string, input: SaveAttemptInput) =>
    this.request<MutationResult>('POST', `/problems/${encodeURIComponent(slug)}/attempts`, input);

  addRevision = (input: CreateRevisionInput) =>
    this.request<MutationResult>('POST', '/revisions', input);
  dueRevisions = () =>
    this.request<{ items: ProblemSummaryDto[] }>('GET', '/revisions/due').then((r) => r.items);

  stats = () => this.request<StatsDto>('GET', '/stats');
  topics = () => this.request<{ items: CategoryCountDto[] }>('GET', '/topics').then((r) => r.items);
  patterns = () =>
    this.request<{ items: CategoryCountDto[] }>('GET', '/patterns').then((r) => r.items);
  tags = () => this.request<{ items: CategoryCountDto[] }>('GET', '/tags').then((r) => r.items);
}
