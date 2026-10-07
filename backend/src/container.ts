import type { Kysely } from 'kysely';
import type { Clock } from './common/clock.js';
import { systemClock } from './common/clock.js';
import { KeyedMutex } from './common/keyed-mutex.js';
import type { Logger } from './common/logger.js';
import type { AppConfig } from './config/env.js';
import type { Database } from './database/schema.js';
import { AuthService } from './modules/auth/auth.service.js';
import { GitHubAccountService } from './modules/github/github-account.service.js';
import type { GitHubApiFactory } from './modules/github/github-account.service.js';
import { GitHubHttpApi } from './modules/github/github-http-api.js';
import { GitHubOAuthHttpClient } from './modules/github/github-oauth.js';
import type { GitHubOAuthClient } from './modules/github/github-oauth.js';
import { ProblemService } from './modules/problems/problem.service.js';
import { RepositoryService } from './modules/repository/repository.service.js';
import { RevisionService } from './modules/revisions/revision.service.js';
import { StatsService } from './modules/stats/stats.service.js';
import { RepositoryProjector } from './modules/sync/projector.js';
import { SyncJobStore } from './modules/sync/sync-jobs.js';
import { SyncService } from './modules/sync/sync.service.js';

export interface ContainerOverrides {
  githubApiFactory?: GitHubApiFactory;
  oauthClient?: GitHubOAuthClient;
  clock?: Clock;
}

export type Container = ReturnType<typeof createContainer>;

/** Wires services together. Tests pass fakes for GitHub and the clock. */
export function createContainer(
  config: AppConfig,
  db: Kysely<Database>,
  logger: Logger,
  overrides: ContainerOverrides = {},
) {
  const clock = overrides.clock ?? systemClock;
  const githubApiFactory =
    overrides.githubApiFactory ?? ((token: string) => new GitHubHttpApi(token));
  const oauthClient =
    overrides.oauthClient ??
    new GitHubOAuthHttpClient(config.github.clientId, config.github.clientSecret);

  const accounts = new GitHubAccountService(db, config.tokenEncryptionKey, githubApiFactory);
  const repositories = new RepositoryService(db, accounts);
  const jobs = new SyncJobStore(db);
  const projector = new RepositoryProjector(db, accounts, repositories);
  const sync = new SyncService(db, jobs, projector, repositories, new KeyedMutex());
  const problems = new ProblemService(db, repositories, sync, clock);
  const revisions = new RevisionService(db, problems, repositories, sync, clock);
  const stats = new StatsService(db, problems, repositories, jobs);
  const auth = new AuthService(
    db,
    {
      publicBaseUrl: config.publicBaseUrl,
      allowedExtensionIds: config.allowedExtensionIds,
      sessionTtlDays: config.sessionTtlDays,
      env: config.env,
    },
    oauthClient,
    githubApiFactory,
    accounts,
    repositories,
    clock,
    logger,
  );

  return {
    config,
    db,
    logger,
    clock,
    accounts,
    repositories,
    jobs,
    projector,
    sync,
    problems,
    revisions,
    stats,
    auth,
  };
}
