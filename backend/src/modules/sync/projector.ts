import type { Kysely } from 'kysely';
import type { ChangeKind, SyncOutcome } from '@lcsync/shared';
import type { Database } from '../../database/schema.js';
import { commitFiles } from '../github/git-committer.js';
import type { GitHubAccountService } from '../github/github-account.service.js';
import { generateRepository } from '../generator/repository-generator.js';
import { isDirtyFor, loadProblems } from '../problems/problem-store.js';
import type { StoredProblem } from '../problems/problem-store.js';
import type { ActiveRepository, RepositoryService } from '../repository/repository.service.js';

export interface ProjectionPlan {
  repository: ActiveRepository;
  /** Every solved problem (indexes are generated from all of them). */
  problems: StoredProblem[];
  /** Problems whose directories will be written. */
  scope: StoredProblem[];
  full: boolean;
}

export interface ProjectionResult {
  outcome: Extract<SyncOutcome, 'committed' | 'up_to_date'>;
  commitSha: string | null;
  commitUrl: string | null;
}

/** What a commit for this problem represents, relative to what the repository already has. */
export function classifyChange(
  p: StoredProblem,
  repositoryId: string,
  language?: string,
): {
  changeKind: ChangeKind;
  language: string | null;
} {
  const here = p.solutions.filter((s) => s.syncedRepositoryId === repositoryId);
  if (here.length === 0)
    return { changeKind: 'new_problem', language: language ?? p.solutions[0]?.language ?? null };
  const unsynced = p.solutions.filter((s) => s.syncedRepositoryId !== repositoryId);
  if (unsynced.length) {
    const lang = unsynced.find((s) => s.language === language) ?? unsynced[0];
    return { changeKind: 'new_language', language: lang?.language ?? null };
  }
  const changed = p.solutions.filter((s) => s.syncedCodeHash !== s.codeHash);
  if (changed.length) {
    const lang = changed.find((s) => s.language === language) ?? changed[0];
    return { changeKind: 'improved', language: lang?.language ?? null };
  }
  if (p.metadataDirty) return { changeKind: 'metadata', language: null };
  return { changeKind: 'none', language: null };
}

/**
 * Phase 2 of a sync: projects database state onto the GitHub branch as one commit and then
 * marks what was pushed. Callers hold the per-user lock.
 */
export class RepositoryProjector {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly github: GitHubAccountService,
    private readonly repositories: RepositoryService,
  ) {}

  /** Scope = the focus problems plus every other problem not yet pushed to this repository. */
  async plan(
    userId: string,
    repository: ActiveRepository,
    focusIds: string[] | 'all',
  ): Promise<ProjectionPlan> {
    const problems = await loadProblems(this.db, userId, { includeCode: true });
    if (focusIds === 'all') return { repository, problems, scope: problems, full: true };
    const focus = new Set(focusIds);
    const scope = problems.filter(
      (p) => focus.has(p.userProblemId) || isDirtyFor(p, repository.id),
    );
    return { repository, problems, scope, full: false };
  }

  async execute(userId: string, plan: ProjectionPlan, message: string): Promise<ProjectionResult> {
    const result = await this.github.withApi(userId, async (api) => {
      const repo = await this.repositories.refreshBeforeWrite(userId, api, plan.repository);
      const output = generateRepository(
        plan.problems,
        plan.full ? 'all' : new Set(plan.scope.map((p) => p.userProblemId)),
        { settings: repo.settings, rootDir: repo.rootDir, isPrivateRepository: repo.isPrivate },
      );
      const commit = await commitFiles(api, {
        ref: { owner: repo.owner, repo: repo.name },
        branch: repo.branch,
        message,
        writes: output.writes,
        merges: output.merges,
        ownedDirs: output.ownedDirs,
      });
      return { commit, repo };
    });

    await this.markSynced(plan, result.commit.commitSha ?? result.commit.headSha);
    const { commitSha } = result.commit;
    return {
      outcome: commitSha ? 'committed' : 'up_to_date',
      commitSha,
      commitUrl: commitSha ? `${result.repo.htmlUrl}/commit/${commitSha}` : null,
    };
  }

  /**
   * Records exactly the hashes that were generated, so a solution updated after planning stays
   * dirty and is picked up by the next sync.
   */
  private async markSynced(plan: ProjectionPlan, commitSha: string): Promise<void> {
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      for (const p of plan.scope) {
        for (const s of p.solutions) {
          await trx
            .updateTable('solutions')
            .set({
              synced_code_hash: s.codeHash,
              synced_repository_id: plan.repository.id,
              last_synced_at: now,
              last_commit_sha: commitSha,
            })
            .where('user_problem_id', '=', p.userProblemId)
            .where('language', '=', s.language)
            .where('code_hash', '=', s.codeHash)
            .execute();
        }
        if (p.metadataDirty) {
          await trx
            .updateTable('user_problems')
            .set({ metadata_dirty: false })
            .where('id', '=', p.userProblemId)
            .execute();
        }
      }
    });
  }
}
