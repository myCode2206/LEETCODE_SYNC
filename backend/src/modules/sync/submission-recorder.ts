import type { Kysely, Transaction } from 'kysely';
import { normalizeLanguageKey, patternsFromTopics, startsNewRevisionSession } from '@lcsync/shared';
import type {
  RepositorySettings,
  RevisionStatus,
  SubmissionStatus,
  SyncProblemRequest,
} from '@lcsync/shared';
import { codeHash } from '../../common/crypto.js';
import type { Database, UserProblemUpdate } from '../../database/schema.js';
import {
  getOrCreateUserProblem,
  setPatterns,
  upsertCatalogProblem,
} from '../problems/problem-store.js';

export interface RecordResult {
  userProblemId: string;
  problem: { slug: string; frontendId: string; title: string; difficulty: string };
  language: string;
  /** False when this LeetCode submission id was already recorded (nothing changed). */
  isNewSubmission: boolean;
  accepted: boolean;
}

type CounterColumn =
  | 'wrong_answer_count'
  | 'time_limit_exceeded_count'
  | 'memory_limit_exceeded_count'
  | 'runtime_error_count'
  | 'compile_error_count';

const COUNTER_BY_STATUS: Partial<Record<SubmissionStatus, CounterColumn>> = {
  wrong_answer: 'wrong_answer_count',
  time_limit_exceeded: 'time_limit_exceeded_count',
  memory_limit_exceeded: 'memory_limit_exceeded_count',
  output_limit_exceeded: 'wrong_answer_count',
  runtime_error: 'runtime_error_count',
  compile_error: 'compile_error_count',
};

/** Status after a new revision session (re-solving). Difficult/mastered are user decisions. */
function statusAfterSession(current: RevisionStatus, isFirstSolve: boolean): RevisionStatus {
  if (isFirstSolve) return current === 'new' ? 'solved' : current;
  return current === 'difficult' || current === 'mastered' ? current : 'revised';
}

const maxDate = (a: Date | null, b: Date) => (a && a > b ? a : b);
const minDate = (a: Date | null, b: Date) => (a && a < b ? a : b);

/**
 * Phase 1 of a sync: records the submission and its effects in ONE transaction.
 * Idempotent: the submission insert is ON CONFLICT DO NOTHING on (user, LeetCode submission id),
 * and every counter/revision/solution change happens only if that insert created a row.
 */
export async function recordSubmission(
  db: Kysely<Database>,
  userId: string,
  req: SyncProblemRequest,
  settings: RepositorySettings,
): Promise<RecordResult> {
  const { problem, submission } = req;
  const language = normalizeLanguageKey(submission.language);
  const accepted = submission.status === 'accepted';
  const submittedAt = new Date(submission.submittedAt);
  const code = accepted ? (submission.code ?? '') : null;
  const hash = code !== null ? codeHash(code) : (submission.codeHash ?? null);

  return db.transaction().execute(async (trx) => {
    const problemId = await upsertCatalogProblem(trx, problem);
    const up = await getOrCreateUserProblem(trx, userId, problemId);
    const base: RecordResult = {
      userProblemId: up.id,
      problem: {
        slug: problem.titleSlug,
        frontendId: problem.frontendId,
        title: problem.title,
        difficulty: problem.difficulty,
      },
      language,
      isNewSubmission: false,
      accepted,
    };

    const inserted = await trx
      .insertInto('submissions')
      .values({
        user_id: userId,
        user_problem_id: up.id,
        leetcode_submission_id: submission.leetcodeSubmissionId,
        language,
        status: submission.status,
        runtime: submission.runtime ?? null,
        memory: submission.memory ?? null,
        runtime_ms: submission.runtimeMs ?? null,
        code,
        code_hash: hash,
        submitted_at: submittedAt,
      })
      .onConflict((oc) => oc.columns(['user_id', 'leetcode_submission_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return base; // Duplicate delivery: already counted.

    const update: UserProblemUpdate = {
      attempt_count: up.attempt_count + 1,
      updated_at: new Date(),
    };
    const counter = COUNTER_BY_STATUS[submission.status];
    if (counter) update[counter] = up[counter] + 1;

    if (accepted && code !== null && hash !== null) {
      const isFirstSolve = up.accepted_count === 0;
      update.accepted_count = up.accepted_count + 1;
      update.first_solved_at = minDate(up.first_solved_at, submittedAt);
      update.last_solved_at = maxDate(up.last_solved_at, submittedAt);

      // Out-of-order deliveries (older than the latest solve) never start a new session.
      const inOrder = !up.last_solved_at || submittedAt >= up.last_solved_at;
      if (inOrder && startsNewRevisionSession(up.last_solved_at, submittedAt)) {
        update.revision_count = up.revision_count + 1;
        update.last_revised_at = maxDate(up.last_revised_at, submittedAt);
        update.status = statusAfterSession(up.status, isFirstSolve);
        await trx
          .insertInto('revisions')
          .values({
            user_id: userId,
            user_problem_id: up.id,
            revision_type: isFirstSolve ? 'first_solve' : 'resolve',
            created_at: submittedAt,
          })
          .execute();
      }

      if (isFirstSolve && settings.suggestPatternsFromTopics) {
        const hasPatterns = await trx
          .selectFrom('user_problem_patterns')
          .select('pattern_id')
          .where('user_problem_id', '=', up.id)
          .executeTakeFirst();
        if (!hasPatterns)
          await setPatterns(trx, up.id, patternsFromTopics(problem.topics.map((t) => t.slug)));
      }

      await upsertSolution(trx, up.id, language, code, hash, submittedAt, req, settings);
    }

    await trx.updateTable('user_problems').set(update).where('id', '=', up.id).execute();
    return { ...base, isNewSubmission: true };
  });
}

async function upsertSolution(
  trx: Transaction<Database>,
  userProblemId: string,
  language: string,
  code: string,
  hash: string,
  submittedAt: Date,
  req: SyncProblemRequest,
  settings: RepositorySettings,
): Promise<void> {
  const { submission } = req;
  const existing = await trx
    .selectFrom('solutions')
    .selectAll()
    .where('user_problem_id', '=', userProblemId)
    .where('language', '=', language)
    .executeTakeFirst();

  if (!existing) {
    await trx
      .insertInto('solutions')
      .values({
        user_problem_id: userProblemId,
        language,
        code,
        code_hash: hash,
        runtime: submission.runtime ?? null,
        memory: submission.memory ?? null,
        runtime_ms: submission.runtimeMs ?? null,
        source_submission_id: submission.leetcodeSubmissionId,
        source_submitted_at: submittedAt,
        updated_at: submittedAt,
      })
      .execute();
    return;
  }

  let replace: boolean;
  switch (settings.solutionUpdatePolicy) {
    case 'latest':
      replace = submittedAt >= existing.source_submitted_at;
      break;
    case 'best_runtime':
      replace =
        submission.runtimeMs != null &&
        (existing.runtime_ms == null || submission.runtimeMs < existing.runtime_ms);
      break;
    case 'keep_first':
      replace = false;
      break;
  }
  if (!replace) return;

  const codeChanged = existing.code_hash !== hash;
  await trx
    .updateTable('solutions')
    .set({
      code,
      code_hash: hash,
      runtime: submission.runtime ?? null,
      memory: submission.memory ?? null,
      runtime_ms: submission.runtimeMs ?? null,
      source_submission_id: submission.leetcodeSubmissionId,
      source_submitted_at: submittedAt,
      ...(codeChanged ? { updated_at: submittedAt } : {}),
    })
    .where('id', '=', existing.id)
    .execute();
}
