import type { Kysely } from 'kysely';
import type { SyncJobDto, SyncJobKind, SyncResultDto } from '@lcsync/shared';
import { AppError, isAppError } from '../../common/app-error.js';
import type { Database, SyncJobRow } from '../../database/schema.js';

/** A job still "running" after this long is assumed to belong to a crashed process. */
const STALE_RUNNING_MS = 5 * 60 * 1000;

export type ClaimResult =
  { kind: 'claimed'; jobId: string } | { kind: 'completed'; result: SyncResultDto };

export class SyncJobStore {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Claims an idempotency key. A key that already succeeded returns its stored result; a key
   * that failed (or whose worker died) is re-run; a key that is running elsewhere is rejected.
   */
  async claim(
    userId: string,
    idempotencyKey: string,
    kind: SyncJobKind,
    repositoryId: string | null,
    problem: { slug: string; title: string } | null,
  ): Promise<ClaimResult> {
    const inserted = await this.db
      .insertInto('sync_jobs')
      .values({
        user_id: userId,
        repository_id: repositoryId,
        kind,
        idempotency_key: idempotencyKey,
        status: 'running',
        problem_slug: problem?.slug ?? null,
        problem_title: problem?.title ?? null,
      })
      .onConflict((oc) => oc.columns(['user_id', 'idempotency_key']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) return { kind: 'claimed', jobId: inserted.id };

    const existing = await this.db
      .selectFrom('sync_jobs')
      .selectAll()
      .where('user_id', '=', userId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirstOrThrow();

    if (existing.status === 'succeeded' && existing.result) {
      return {
        kind: 'completed',
        result: { ...(existing.result as SyncResultDto), duplicate: true },
      };
    }
    if (
      existing.status === 'running' &&
      Date.now() - existing.updated_at.getTime() < STALE_RUNNING_MS
    ) {
      throw new AppError('SYNC_IN_PROGRESS', 'This submission is already being synced.');
    }
    // Retry of a failed (or abandoned) job.
    await this.db
      .updateTable('sync_jobs')
      .set({
        status: 'running',
        attempts: existing.attempts + 1,
        repository_id: repositoryId,
        error_code: null,
        error_message: null,
        updated_at: new Date(),
      })
      .where('id', '=', existing.id)
      .execute();
    return { kind: 'claimed', jobId: existing.id };
  }

  async succeed(
    jobId: string,
    result: Omit<SyncResultDto, 'jobId' | 'duplicate'>,
  ): Promise<SyncResultDto> {
    const full: SyncResultDto = { ...result, jobId, duplicate: false };
    await this.db
      .updateTable('sync_jobs')
      .set({
        status: 'succeeded',
        outcome: result.outcome,
        change_kind: result.changeKind,
        message: result.message,
        commit_sha: result.commitSha,
        commit_url: result.commitUrl,
        problem_slug: result.problem?.slug ?? null,
        problem_title: result.problem?.title ?? null,
        result: JSON.stringify(full),
        updated_at: new Date(),
        finished_at: new Date(),
      })
      .where('id', '=', jobId)
      .execute();
    return full;
  }

  async fail(jobId: string, err: unknown): Promise<void> {
    const code = isAppError(err) ? err.code : 'INTERNAL';
    const message = isAppError(err) ? err.message : 'Unexpected error during sync.';
    await this.db
      .updateTable('sync_jobs')
      .set({
        status: 'failed',
        error_code: code,
        error_message: message,
        updated_at: new Date(),
        finished_at: new Date(),
      })
      .where('id', '=', jobId)
      .execute();
  }

  async listRecent(userId: string, limit = 20): Promise<SyncJobDto[]> {
    const rows = await this.db
      .selectFrom('sync_jobs')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toJobDto);
  }
}

export function toJobDto(row: SyncJobRow): SyncJobDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    outcome: row.outcome,
    message: row.status === 'failed' ? row.error_message : row.message,
    commitSha: row.commit_sha,
    commitUrl: row.commit_url,
    problemSlug: row.problem_slug,
    problemTitle: row.problem_title,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}
