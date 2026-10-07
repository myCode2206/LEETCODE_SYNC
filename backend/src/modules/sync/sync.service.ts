import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { DEFAULT_REPOSITORY_SETTINGS, STATUS_LABELS } from '@lcsync/shared';
import type { SyncJobKind, SyncProblemRequest, SyncResultDto } from '@lcsync/shared';
import type { KeyedMutex } from '../../common/keyed-mutex.js';
import type { Database } from '../../database/schema.js';
import { buildCommitMessage, fullSyncMessage } from '../generator/commit-message.js';
import type { StoredProblem } from '../problems/problem-store.js';
import type { ActiveRepository, RepositoryService } from '../repository/repository.service.js';
import { classifyChange } from './projector.js';
import type { RepositoryProjector } from './projector.js';
import { recordSubmission } from './submission-recorder.js';
import type { SyncJobStore } from './sync-jobs.js';

type JobResult = Omit<SyncResultDto, 'jobId' | 'duplicate'>;

interface ProblemRef {
  slug: string;
  frontendId: string;
  title: string;
}

function problemRef(p: { titleSlug: string; frontendId: string; title: string }): ProblemRef {
  return { slug: p.titleSlug, frontendId: p.frontendId, title: p.title };
}

function recorded(message: string, problem: ProblemRef | null): JobResult {
  return {
    outcome: 'recorded',
    changeKind: 'none',
    commitSha: null,
    commitUrl: null,
    message,
    problem,
  };
}

export class SyncService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly jobs: SyncJobStore,
    private readonly projector: RepositoryProjector,
    private readonly repositories: RepositoryService,
    private readonly locks: KeyedMutex,
  ) {}

  /** Serialises every write for a user (recording, editing, committing). */
  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return this.locks.run(`user:${userId}`, fn);
  }

  /** POST /sync/problem — record a LeetCode submission and publish it if anything changed. */
  async syncSubmission(userId: string, req: SyncProblemRequest): Promise<SyncResultDto> {
    return this.withUserLock(userId, async () => {
      const repo = await this.repositories.getActive(userId);
      const ref = {
        slug: req.problem.titleSlug,
        frontendId: req.problem.frontendId,
        title: req.problem.title,
      };
      return this.runJob(userId, req.idempotencyKey, 'submission', repo, ref, async () => {
        const rec = await recordSubmission(
          this.db,
          userId,
          req,
          repo?.settings ?? DEFAULT_REPOSITORY_SETTINGS,
        );
        const label = rec.accepted ? 'Solution' : STATUS_LABELS[req.submission.status];

        if (!repo)
          return recorded(
            `${label} saved. Choose a GitHub repository in Settings to publish it.`,
            ref,
          );
        if (!req.options.commit)
          return recorded(`${label} saved. It will be pushed with your pending changes.`, ref);

        const plan = await this.projector.plan(userId, repo, [rec.userProblemId]);
        const focus = plan.scope.find((p) => p.userProblemId === rec.userProblemId);
        if (!focus) return recorded(`${label} recorded in your history.`, ref); // never solved: no files yet

        const cls = classifyChange(focus, repo.id, rec.language);
        const metadataCommit =
          cls.changeKind === 'none' &&
          rec.isNewSubmission &&
          repo.settings.commitMetadataOnlyChanges;
        if (cls.changeKind === 'none' && !metadataCommit) {
          return recorded(
            !rec.isNewSubmission
              ? `${ref.title} is already synced.`
              : rec.accepted
                ? `${ref.title}: identical solution — attempt recorded, no commit needed.`
                : `${label} recorded for ${ref.title}.`,
            ref,
          );
        }

        const changeKind = cls.changeKind === 'none' ? 'metadata' : cls.changeKind;
        const message = buildCommitMessage(
          {
            changeKind,
            frontendId: focus.frontendId,
            title: focus.title,
            slug: focus.titleSlug,
            difficulty: focus.difficulty,
            language: cls.language,
            additionalProblems: plan.scope.length - 1,
          },
          repo.settings.commitMessageTemplate,
        );
        const res = await this.projector.execute(userId, plan, message);
        return {
          ...res,
          changeKind,
          message:
            res.outcome === 'committed'
              ? `✓ ${ref.title} synced to GitHub`
              : `${ref.title} is already up to date on GitHub`,
          problem: ref,
        };
      });
    });
  }

  /** POST /sync/pending — push everything recorded but not yet on GitHub. */
  async pushPending(userId: string): Promise<SyncResultDto> {
    return this.withUserLock(userId, async () => {
      const repo = await this.repositories.requireActive(userId);
      return this.runJob(userId, `pending:${randomUUID()}`, 'full', repo, null, async () => {
        const plan = await this.projector.plan(userId, repo, []);
        if (plan.scope.length === 0) {
          return {
            ...recorded('Nothing to push — GitHub is up to date.', null),
            outcome: 'up_to_date',
          };
        }
        const single = plan.scope.length === 1 ? plan.scope[0] : undefined;
        const message = single ? this.messageFor(single, repo) : fullSyncMessage(plan.scope.length);
        const res = await this.projector.execute(userId, plan, message);
        return {
          ...res,
          changeKind: single ? classifyChange(single, repo.id).changeKind : 'metadata',
          message: `Pushed ${plan.scope.length} pending problem${plan.scope.length === 1 ? '' : 's'}.`,
          problem: single ? problemRef(single) : null,
        };
      });
    });
  }

  /** POST /sync/full — regenerate every file (repair, new repository, settings change). */
  async fullSync(userId: string): Promise<SyncResultDto> {
    return this.withUserLock(userId, async () => {
      const repo = await this.repositories.requireActive(userId);
      return this.runJob(userId, `full:${randomUUID()}`, 'full', repo, null, async () => {
        const plan = await this.projector.plan(userId, repo, 'all');
        const message = plan.problems.length
          ? fullSyncMessage(plan.problems.length)
          : 'leetcode: initialize repository';
        const res = await this.projector.execute(userId, plan, message);
        return {
          ...res,
          changeKind: 'metadata',
          message:
            res.outcome === 'committed'
              ? `Repository rebuilt with ${plan.problems.length} problems.`
              : 'Repository is already up to date.',
          problem: null,
        };
      });
    });
  }

  /**
   * Publishes one problem after a user edit (metadata, saved attempt). Caller holds the user
   * lock. Returns null when no repository is configured (the change stays pending).
   */
  async publishProblemLocked(
    userId: string,
    userProblemId: string,
    kind: Extract<SyncJobKind, 'metadata' | 'attempt'>,
    message?: (p: StoredProblem, repo: ActiveRepository) => string,
  ): Promise<SyncResultDto | null> {
    const repo = await this.repositories.getActive(userId);
    if (!repo) return null;
    return this.runJob(userId, `${kind}:${randomUUID()}`, kind, repo, null, async () => {
      const plan = await this.projector.plan(userId, repo, [userProblemId]);
      const focus = plan.scope.find((p) => p.userProblemId === userProblemId);
      if (!focus)
        return recorded('Saved. The problem will appear on GitHub once it is solved.', null);
      const commitMessage = message
        ? message(focus, repo)
        : this.messageFor(focus, repo, plan.scope.length - 1);
      const res = await this.projector.execute(userId, plan, commitMessage);
      return {
        ...res,
        changeKind: 'metadata',
        message:
          res.outcome === 'committed'
            ? `✓ ${focus.title} updated on GitHub`
            : `${focus.title} is up to date`,
        problem: problemRef(focus),
      };
    });
  }

  private messageFor(p: StoredProblem, repo: ActiveRepository, additionalProblems = 0): string {
    const cls = classifyChange(p, repo.id);
    return buildCommitMessage(
      {
        changeKind: cls.changeKind === 'none' ? 'metadata' : cls.changeKind,
        frontendId: p.frontendId,
        title: p.title,
        slug: p.titleSlug,
        difficulty: p.difficulty,
        language: cls.language,
        additionalProblems,
      },
      repo.settings.commitMessageTemplate,
    );
  }

  private async runJob(
    userId: string,
    key: string,
    kind: SyncJobKind,
    repo: ActiveRepository | null,
    problem: ProblemRef | null,
    fn: () => Promise<JobResult>,
  ): Promise<SyncResultDto> {
    const claim = await this.jobs.claim(userId, key, kind, repo?.id ?? null, problem);
    if (claim.kind === 'completed') return claim.result;
    try {
      return await this.jobs.succeed(claim.jobId, await fn());
    } catch (err) {
      await this.jobs.fail(claim.jobId, err);
      throw err;
    }
  }
}
