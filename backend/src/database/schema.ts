/**
 * Kysely table types. Must match the migrations in ./migrations.
 *
 * Relationships:
 *   users 1─1 github_accounts            users 1─* repositories (one active)
 *   problems *─* topics (problem_topics) global LeetCode catalog
 *   users 1─* user_problems *─1 problems per-user progress on a problem
 *   user_problems *─* patterns           user_problems *─* custom_tags
 *   user_problems 1─* solutions          (unique per language)
 *   user_problems 1─* submissions        user_problems 1─* revisions
 *   users 1─* sync_jobs                  (unique per idempotency key)
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  ChangeKind,
  Difficulty,
  RepositorySettings,
  RevisionStatus,
  RevisionType,
  SaveAttemptKind,
  SubmissionStatus,
  SyncJobKind,
  SyncJobStatus,
  SyncOutcome,
} from '@lcsync/shared';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
type Json<T> = ColumnType<T, string, string>;

export interface UsersTable {
  id: Generated<string>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GithubAccountsTable {
  id: Generated<string>;
  user_id: string;
  github_user_id: number;
  login: string;
  avatar_url: string | null;
  access_token_encrypted: string;
  scopes: string;
  needs_reconnect: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OauthStatesTable {
  state_hash: string;
  redirect_uri: string;
  access_level: 'public' | 'private';
  expires_at: Timestamp;
  created_at: Timestamp;
}

export interface AuthCodesTable {
  code_hash: string;
  user_id: string;
  expires_at: Timestamp;
  used_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  last_used_at: Timestamp;
  created_at: Timestamp;
}

export interface RepositoriesTable {
  id: Generated<string>;
  user_id: string;
  github_repo_id: number;
  owner: string;
  name: string;
  is_private: boolean;
  html_url: string;
  branch: string;
  root_dir: string;
  settings: Json<RepositorySettings>;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProblemsTable {
  id: Generated<string>;
  question_id: string;
  frontend_id: string;
  title: string;
  title_slug: string;
  difficulty: Difficulty;
  /** Assigned once; never changes even if the title or slug changes. */
  directory_name: string;
  is_paid_only: boolean;
  /** LeetCode's problem statement (HTML); null until a client sends it. */
  content: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TopicsTable {
  id: Generated<string>;
  slug: string;
  name: string;
}

export interface ProblemTopicsTable {
  problem_id: string;
  topic_id: string;
}

export interface PatternsTable {
  id: Generated<string>;
  slug: string;
  name: string;
}

export interface CustomTagsTable {
  id: Generated<string>;
  user_id: string;
  slug: string;
  name: string;
}

export interface UserProblemsTable {
  id: Generated<string>;
  user_id: string;
  problem_id: string;
  status: RevisionStatus;
  notes: string | null;
  time_complexity: string | null;
  space_complexity: string | null;
  attempt_count: Generated<number>;
  accepted_count: Generated<number>;
  wrong_answer_count: Generated<number>;
  time_limit_exceeded_count: Generated<number>;
  memory_limit_exceeded_count: Generated<number>;
  runtime_error_count: Generated<number>;
  compile_error_count: Generated<number>;
  revision_count: Generated<number>;
  first_solved_at: NullableTimestamp;
  last_solved_at: NullableTimestamp;
  last_revised_at: NullableTimestamp;
  /** User-edited metadata not yet pushed to GitHub. */
  metadata_dirty: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UserProblemPatternsTable {
  user_problem_id: string;
  pattern_id: string;
}

export interface UserProblemTagsTable {
  user_problem_id: string;
  tag_id: string;
}

export interface SolutionsTable {
  id: Generated<string>;
  user_problem_id: string;
  language: string;
  code: string;
  code_hash: string;
  runtime: string | null;
  memory: string | null;
  runtime_ms: number | null;
  source_submission_id: string;
  source_submitted_at: Timestamp;
  synced_code_hash: string | null;
  synced_repository_id: string | null;
  last_synced_at: NullableTimestamp;
  last_commit_sha: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SubmissionsTable {
  id: Generated<string>;
  user_id: string;
  user_problem_id: string;
  leetcode_submission_id: string;
  language: string;
  status: SubmissionStatus;
  runtime: string | null;
  memory: string | null;
  runtime_ms: number | null;
  /** Stored for accepted submissions only. */
  code: string | null;
  code_hash: string | null;
  submitted_at: Timestamp;
  saved_attempt_path: string | null;
  saved_attempt_kind: SaveAttemptKind | null;
  saved_attempt_note: string | null;
  created_at: Timestamp;
}

export interface RevisionsTable {
  id: Generated<string>;
  user_id: string;
  user_problem_id: string;
  revision_type: RevisionType;
  notes: string | null;
  created_at: Timestamp;
}

export interface SyncJobsTable {
  id: Generated<string>;
  user_id: string;
  repository_id: string | null;
  kind: SyncJobKind;
  idempotency_key: string;
  status: SyncJobStatus;
  outcome: SyncOutcome | null;
  change_kind: ChangeKind | null;
  message: string | null;
  commit_sha: string | null;
  commit_url: string | null;
  problem_slug: string | null;
  problem_title: string | null;
  error_code: string | null;
  error_message: string | null;
  attempts: Generated<number>;
  result: Json<unknown> | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  finished_at: NullableTimestamp;
}

export interface Database {
  users: UsersTable;
  github_accounts: GithubAccountsTable;
  oauth_states: OauthStatesTable;
  auth_codes: AuthCodesTable;
  sessions: SessionsTable;
  repositories: RepositoriesTable;
  problems: ProblemsTable;
  topics: TopicsTable;
  problem_topics: ProblemTopicsTable;
  patterns: PatternsTable;
  custom_tags: CustomTagsTable;
  user_problems: UserProblemsTable;
  user_problem_patterns: UserProblemPatternsTable;
  user_problem_tags: UserProblemTagsTable;
  solutions: SolutionsTable;
  submissions: SubmissionsTable;
  revisions: RevisionsTable;
  sync_jobs: SyncJobsTable;
}

export type RepositoryRow = Selectable<RepositoriesTable>;
export type UserProblemRow = Selectable<UserProblemsTable>;
export type SolutionRow = Selectable<SolutionsTable>;
export type SubmissionRow = Selectable<SubmissionsTable>;
export type SyncJobRow = Selectable<SyncJobsTable>;
export type NewSubmission = Insertable<SubmissionsTable>;
export type UserProblemUpdate = Updateable<UserProblemsTable>;
