import type { Kysely } from 'kysely';
import type { CreateRevisionInput, ProblemSummaryDto, RevisionStatus } from '@lcsync/shared';
import { isAppError, notFound } from '../../common/app-error.js';
import type { Clock } from '../../common/clock.js';
import type { Database } from '../../database/schema.js';
import type { MutationResult, ProblemService } from '../problems/problem.service.js';
import { findUserProblemBySlug } from '../problems/problem-store.js';
import type { RepositoryService } from '../repository/repository.service.js';
import type { SyncService } from '../sync/sync.service.js';

/** Manual "I revised this" moves the status forward unless the user set a stronger one. */
function statusAfterManualRevision(current: RevisionStatus): RevisionStatus {
  return current === 'difficult' || current === 'mastered' ? current : 'revised';
}

export class RevisionService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly problems: ProblemService,
    private readonly repositories: RepositoryService,
    private readonly sync: SyncService,
    private readonly clock: Clock,
  ) {}

  /**
   * Records a manual revision. Revision counters are activity metadata: they are pushed to
   * GitHub immediately only if "commit metadata-only changes" is on, otherwise with the next
   * commit for this problem.
   */
  async addRevision(userId: string, input: CreateRevisionInput): Promise<MutationResult> {
    return this.sync.withUserLock(userId, async () => {
      const ref = await findUserProblemBySlug(this.db, userId, input.problemSlug);
      if (!ref) throw notFound('Problem');
      const repo = await this.repositories.getActive(userId);
      const publishNow = repo?.settings.commitMetadataOnlyChanges ?? false;
      const now = this.clock.now();

      await this.db.transaction().execute(async (trx) => {
        const up = await trx
          .selectFrom('user_problems')
          .select(['status', 'revision_count'])
          .where('id', '=', ref.userProblemId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('revisions')
          .values({
            user_id: userId,
            user_problem_id: ref.userProblemId,
            revision_type: 'manual',
            notes: input.notes?.trim() || null,
            created_at: now,
          })
          .execute();
        await trx
          .updateTable('user_problems')
          .set({
            revision_count: up.revision_count + 1,
            last_revised_at: now,
            status: input.status ?? statusAfterManualRevision(up.status),
            ...(publishNow ? { metadata_dirty: true } : {}),
            updated_at: now,
          })
          .where('id', '=', ref.userProblemId)
          .execute();
      });

      let sync: MutationResult['sync'] = null;
      let syncError: MutationResult['syncError'] = null;
      if (publishNow) {
        try {
          sync = await this.sync.publishProblemLocked(userId, ref.userProblemId, 'metadata');
        } catch (err) {
          if (!isAppError(err)) throw err;
          syncError = { code: err.code, message: err.message };
        }
      }
      return { problem: await this.problems.detail(userId, input.problemSlug), sync, syncError };
    });
  }

  async due(userId: string): Promise<ProblemSummaryDto[]> {
    const all = await this.problems.list(userId, { due: true });
    return all.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  }
}
