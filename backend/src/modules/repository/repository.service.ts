import type { Kysely } from 'kysely';
import {
  normalizeRootDir,
  RepositoryConfigInputSchema,
  RepositorySettingsSchema,
} from '@lcsync/shared';
import type {
  BranchDto,
  CreateRepositoryInput,
  GitHubRepoDto,
  RepositoryConfigDto,
  RepositoryConfigInput,
  RepositorySettings,
} from '@lcsync/shared';
import { AppError, isAppError } from '../../common/app-error.js';
import type { Database, RepositoryRow } from '../../database/schema.js';
import type { GitHubApi, GitHubRepository } from '../github/github-api.js';
import type { GitHubAccountService } from '../github/github-account.service.js';
import { accessLevelFromScopes } from '../github/github-oauth.js';

export interface ActiveRepository {
  id: string;
  githubRepoId: number;
  owner: string;
  name: string;
  isPrivate: boolean;
  htmlUrl: string;
  branch: string;
  rootDir: string;
  settings: RepositorySettings;
}

export function toActiveRepository(row: RepositoryRow): ActiveRepository {
  return {
    id: row.id,
    githubRepoId: row.github_repo_id,
    owner: row.owner,
    name: row.name,
    isPrivate: row.is_private,
    htmlUrl: row.html_url,
    branch: row.branch,
    rootDir: row.root_dir,
    // Parsing fills defaults for settings added after the row was written.
    settings: RepositorySettingsSchema.parse(row.settings ?? {}),
  };
}

export function toRepositoryDto(repo: ActiveRepository): RepositoryConfigDto {
  return {
    id: repo.id,
    githubRepoId: repo.githubRepoId,
    owner: repo.owner,
    name: repo.name,
    fullName: `${repo.owner}/${repo.name}`,
    private: repo.isPrivate,
    branch: repo.branch,
    rootDir: repo.rootDir,
    htmlUrl: repo.htmlUrl,
    settings: repo.settings,
  };
}

function toGitHubRepoDto(r: GitHubRepository): GitHubRepoDto {
  return {
    id: r.id,
    owner: r.owner,
    name: r.name,
    fullName: r.fullName,
    private: r.private,
    defaultBranch: r.defaultBranch,
    canPush: r.canPush,
    htmlUrl: r.htmlUrl,
  };
}

export class RepositoryService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly github: GitHubAccountService,
  ) {}

  async getActive(userId: string): Promise<ActiveRepository | null> {
    const row = await this.db
      .selectFrom('repositories')
      .selectAll()
      .where('user_id', '=', userId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    return row ? toActiveRepository(row) : null;
  }

  async requireActive(userId: string): Promise<ActiveRepository> {
    const repo = await this.getActive(userId);
    if (!repo) {
      throw new AppError(
        'REPOSITORY_NOT_CONFIGURED',
        'Choose a GitHub repository in Settings before syncing.',
      );
    }
    return repo;
  }

  async listGitHubRepositories(userId: string): Promise<GitHubRepoDto[]> {
    const repos = await this.github.withApi(userId, (api) => api.listRepositories());
    return repos.map(toGitHubRepoDto);
  }

  async listBranches(userId: string, githubRepoId: number): Promise<BranchDto[]> {
    return this.github.withApi(userId, async (api) => {
      const repo = await this.fetchRepository(userId, api, githubRepoId);
      return api.listBranches({ owner: repo.owner, repo: repo.name });
    });
  }

  async createGitHubRepository(
    userId: string,
    input: CreateRepositoryInput,
  ): Promise<GitHubRepoDto> {
    const scopes = await this.github.getScopes(userId);
    if (input.private && accessLevelFromScopes(scopes) !== 'private') {
      throw new AppError(
        'GITHUB_PERMISSION_DENIED',
        'Creating a private repository requires private-repository access. Reconnect GitHub and choose "Public and private repositories".',
      );
    }
    const created = await this.github.withApi(userId, (api) => api.createRepository(input));
    return toGitHubRepoDto(created);
  }

  /** Validates access to the repository and branch, then makes it the active sync target. */
  async configure(userId: string, rawInput: RepositoryConfigInput): Promise<RepositoryConfigDto> {
    const input = RepositoryConfigInputSchema.parse(rawInput);
    let rootDir: string;
    try {
      rootDir = normalizeRootDir(input.rootDir);
    } catch (err) {
      throw new AppError('INVALID_REPOSITORY_CONFIG', (err as Error).message);
    }

    const repo = await this.github.withApi(userId, async (api) => {
      const repo = await this.fetchRepository(userId, api, input.githubRepoId);
      if (!repo.canPush) {
        throw new AppError(
          'GITHUB_PERMISSION_DENIED',
          `You don't have write access to ${repo.fullName}. Choose a repository you can push to.`,
        );
      }
      const head = await api.getBranchHead({ owner: repo.owner, repo: repo.name }, input.branch);
      if (head.state === 'missing') {
        throw new AppError(
          'GITHUB_BRANCH_NOT_FOUND',
          `Branch "${input.branch}" does not exist in ${repo.fullName}.`,
        );
      }
      if (head.state === 'empty' && input.branch !== repo.defaultBranch) {
        throw new AppError(
          'INVALID_REPOSITORY_CONFIG',
          `${repo.fullName} is empty. Use its default branch "${repo.defaultBranch}" for the first sync.`,
        );
      }
      return repo;
    });

    const row = await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('repositories')
        .set({ is_active: false, updated_at: new Date() })
        .where('user_id', '=', userId)
        .where('is_active', '=', true)
        .execute();
      return trx
        .insertInto('repositories')
        .values({
          user_id: userId,
          github_repo_id: repo.id,
          owner: repo.owner,
          name: repo.name,
          is_private: repo.private,
          html_url: repo.htmlUrl,
          branch: input.branch,
          root_dir: rootDir,
          settings: JSON.stringify(input.settings),
          is_active: true,
        })
        .onConflict((oc) =>
          oc.columns(['user_id', 'github_repo_id', 'branch', 'root_dir']).doUpdateSet({
            owner: repo.owner,
            name: repo.name,
            is_private: repo.private,
            html_url: repo.htmlUrl,
            settings: JSON.stringify(input.settings),
            is_active: true,
            updated_at: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return toRepositoryDto(toActiveRepository(row));
  }

  async updateSettings(
    userId: string,
    settings: Partial<RepositorySettings>,
  ): Promise<RepositoryConfigDto> {
    const active = await this.requireActive(userId);
    const merged = RepositorySettingsSchema.parse({ ...active.settings, ...settings });
    await this.db
      .updateTable('repositories')
      .set({ settings: JSON.stringify(merged), updated_at: new Date() })
      .where('id', '=', active.id)
      .execute();
    return toRepositoryDto({ ...active, settings: merged });
  }

  /**
   * Re-reads the repository from GitHub by its numeric id before writing to it. This follows
   * renames/transfers and username changes, and catches deletion, loss of access, and a
   * public repository that became private.
   */
  async refreshBeforeWrite(
    userId: string,
    api: GitHubApi,
    active: ActiveRepository,
  ): Promise<ActiveRepository> {
    const repo = await this.fetchRepository(userId, api, active.githubRepoId);
    if (!repo.canPush) {
      throw new AppError(
        'GITHUB_PERMISSION_DENIED',
        `You no longer have write access to ${repo.fullName}. Choose another repository in Settings.`,
      );
    }
    if (
      repo.owner !== active.owner ||
      repo.name !== active.name ||
      repo.private !== active.isPrivate
    ) {
      await this.db
        .updateTable('repositories')
        .set({
          owner: repo.owner,
          name: repo.name,
          is_private: repo.private,
          html_url: repo.htmlUrl,
          updated_at: new Date(),
        })
        .where('id', '=', active.id)
        .execute();
    }
    return {
      ...active,
      owner: repo.owner,
      name: repo.name,
      isPrivate: repo.private,
      htmlUrl: repo.htmlUrl,
    };
  }

  private async fetchRepository(
    userId: string,
    api: GitHubApi,
    githubRepoId: number,
  ): Promise<GitHubRepository> {
    try {
      return await api.getRepositoryById(githubRepoId);
    } catch (err) {
      if (isAppError(err) && err.code === 'GITHUB_REPO_NOT_FOUND') {
        const scopes = await this.github.getScopes(userId);
        if (accessLevelFromScopes(scopes) === 'public') {
          throw new AppError(
            'GITHUB_REPO_NOT_FOUND',
            'Repository not found. If it is private, reconnect GitHub with "Public and private repositories" access.',
          );
        }
      }
      throw err;
    }
  }
}
