import type { Kysely } from 'kysely';
import { compareByProblemNumber, filterProblems, getLanguage } from '@lcsync/shared';
import type {
  ErrorCode,
  ProblemDetailDto,
  ProblemListQuery,
  ProblemSummaryDto,
  SaveAttemptInput,
  SyncResultDto,
  UpdateProblemInput,
} from '@lcsync/shared';
import { AppError, isAppError, notFound } from '../../common/app-error.js';
import type { Clock } from '../../common/clock.js';
import type { Database } from '../../database/schema.js';
import { saveAttemptMessage } from '../generator/commit-message.js';
import type { RepositoryService } from '../repository/repository.service.js';
import type { SyncService } from '../sync/sync.service.js';
import { toSolutionDtos, toSummaryDto } from './problem-dto.js';
import {
  findUserProblemBySlug,
  loadProblems,
  setCustomTags,
  setPatterns,
} from './problem-store.js';

export interface MutationResult {
  problem: ProblemDetailDto;
  /** Result of publishing the change; null if no repository is configured. */
  sync: SyncResultDto | null;
  /** Set when the change was saved but could not be pushed yet (it stays pending). */
  syncError: { code: ErrorCode; message: string } | null;
}

export class ProblemService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly repositories: RepositoryService,
    private readonly sync: SyncService,
    private readonly clock: Clock,
  ) {}

  async list(userId: string, query: ProblemListQuery = {}): Promise<ProblemSummaryDto[]> {
    const repo = await this.repositories.getActive(userId);
    const now = this.clock.now();
    const all = (await loadProblems(this.db, userId)).map((p) => toSummaryDto(p, repo, now));
    return filterProblems(all, query).sort(compareByProblemNumber);
  }

  async detail(userId: string, slug: string): Promise<ProblemDetailDto> {
    const ref = await findUserProblemBySlug(this.db, userId, slug);
    if (!ref) throw notFound('Problem');
    const [p] = await loadProblems(this.db, userId, {
      userProblemIds: [ref.userProblemId],
      solvedOnly: false,
    });
    if (!p) throw notFound('Problem');
    const repo = await this.repositories.getActive(userId);

    const submissions = await this.db
      .selectFrom('submissions')
      .select([
        'leetcode_submission_id',
        'status',
        'language',
        'runtime',
        'memory',
        'submitted_at',
        'saved_attempt_path',
        'code_hash',
      ])
      .select((eb) => eb('code', 'is not', null).as('has_code'))
      .where('user_problem_id', '=', ref.userProblemId)
      .orderBy('submitted_at', 'desc')
      .limit(50)
      .execute();
    const revisions = await this.db
      .selectFrom('revisions')
      .select(['id', 'revision_type', 'notes', 'created_at'])
      .where('user_problem_id', '=', ref.userProblemId)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();

    return {
      ...toSummaryDto(p, repo, this.clock.now()),
      notes: p.notes,
      timeComplexity: p.timeComplexity,
      spaceComplexity: p.spaceComplexity,
      wrongAnswerCount: p.counts.wrongAnswer,
      timeLimitExceededCount: p.counts.timeLimitExceeded,
      memoryLimitExceededCount: p.counts.memoryLimitExceeded,
      runtimeErrorCount: p.counts.runtimeError,
      compileErrorCount: p.counts.compileError,
      solutions: toSolutionDtos(p, repo),
      submissions: submissions.map((s) => ({
        leetcodeSubmissionId: s.leetcode_submission_id,
        status: s.status,
        language: s.language,
        runtime: s.runtime,
        memory: s.memory,
        submittedAt: s.submitted_at.toISOString(),
        savedAttemptPath: s.saved_attempt_path,
        hasCode: Boolean(s.has_code),
      })),
      revisions: revisions.map((r) => ({
        id: r.id,
        type: r.revision_type,
        notes: r.notes,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  /** User edits (patterns, tags, status, notes, complexity). Never touches official topics. */
  async update(userId: string, slug: string, input: UpdateProblemInput): Promise<MutationResult> {
    return this.sync.withUserLock(userId, async () => {
      const ref = await findUserProblemBySlug(this.db, userId, slug);
      if (!ref) throw notFound('Problem');
      const now = this.clock.now();
      await this.db.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom('user_problems')
          .select(['status'])
          .where('id', '=', ref.userProblemId)
          .executeTakeFirstOrThrow();
        if (input.patterns) await setPatterns(trx, ref.userProblemId, input.patterns);
        if (input.customTags) await setCustomTags(trx, userId, ref.userProblemId, input.customTags);
        await trx
          .updateTable('user_problems')
          .set({
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
            ...(input.timeComplexity !== undefined
              ? { time_complexity: input.timeComplexity || null }
              : {}),
            ...(input.spaceComplexity !== undefined
              ? { space_complexity: input.spaceComplexity || null }
              : {}),
            metadata_dirty: true,
            updated_at: now,
          })
          .where('id', '=', ref.userProblemId)
          .execute();
        if (input.status && input.status !== current.status) {
          await trx
            .insertInto('revisions')
            .values({
              user_id: userId,
              user_problem_id: ref.userProblemId,
              revision_type: 'status_change',
              notes: `Status: ${current.status} → ${input.status}`,
              created_at: now,
            })
            .execute();
        }
      });
      return this.publishAndDescribe(userId, slug, ref.userProblemId, 'metadata');
    });
  }

  /** Saves an accepted submission's code under problems/<dir>/attempts/. */
  async saveAttempt(
    userId: string,
    slug: string,
    input: SaveAttemptInput,
  ): Promise<MutationResult> {
    return this.sync.withUserLock(userId, async () => {
      const ref = await findUserProblemBySlug(this.db, userId, slug);
      if (!ref) throw notFound('Problem');
      const submission = await this.db
        .selectFrom('submissions')
        .select(['id', 'language', 'submitted_at', 'code', 'saved_attempt_path'])
        .where('user_problem_id', '=', ref.userProblemId)
        .where('leetcode_submission_id', '=', input.leetcodeSubmissionId)
        .executeTakeFirst();
      if (!submission) throw notFound('Submission');
      if (!submission.code) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Only accepted submissions (which include code) can be saved as attempts.',
        );
      }

      let path = submission.saved_attempt_path;
      if (!path) {
        const date = submission.submitted_at.toISOString().slice(0, 10);
        const file = getLanguage(submission.language).fileName;
        const dot = file.lastIndexOf('.');
        const [stem, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
        const taken = new Set(
          (
            await this.db
              .selectFrom('submissions')
              .select('saved_attempt_path')
              .where('user_problem_id', '=', ref.userProblemId)
              .where('saved_attempt_path', 'is not', null)
              .execute()
          ).map((r) => r.saved_attempt_path),
        );
        path = `attempts/${date}-${stem}${ext}`;
        for (let n = 2; taken.has(path); n++) path = `attempts/${date}-${stem}-${n}${ext}`;
      }

      await this.db
        .updateTable('submissions')
        .set({
          saved_attempt_path: path,
          saved_attempt_kind: input.kind,
          saved_attempt_note: input.note ?? null,
        })
        .where('id', '=', submission.id)
        .execute();
      await this.db
        .updateTable('user_problems')
        .set({ metadata_dirty: true })
        .where('id', '=', ref.userProblemId)
        .execute();

      return this.publishAndDescribe(userId, slug, ref.userProblemId, 'attempt', () =>
        saveAttemptMessage(ref.frontend_id, ref.title, submission.language),
      );
    });
  }

  /**
   * Publishes a saved change. A GitHub failure does not lose the edit: it stays pending and
   * the error is reported alongside the saved problem.
   */
  private async publishAndDescribe(
    userId: string,
    slug: string,
    userProblemId: string,
    kind: 'metadata' | 'attempt',
    message?: () => string,
  ): Promise<MutationResult> {
    let sync: SyncResultDto | null = null;
    let syncError: MutationResult['syncError'] = null;
    try {
      sync = await this.sync.publishProblemLocked(
        userId,
        userProblemId,
        kind,
        message ? () => message() : undefined,
      );
    } catch (err) {
      if (!isAppError(err)) throw err;
      syncError = { code: err.code, message: err.message };
    }
    return { problem: await this.detail(userId, slug), sync, syncError };
  }
}
