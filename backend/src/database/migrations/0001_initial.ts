import { sql } from 'kysely';
import type { Kysely } from 'kysely';

const UP = [
  `CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // GitHub identity is keyed by the numeric GitHub user id, so username changes are harmless.
  `CREATE TABLE github_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    github_user_id bigint NOT NULL UNIQUE,
    login text NOT NULL,
    avatar_url text,
    access_token_encrypted text NOT NULL,
    scopes text NOT NULL DEFAULT '',
    needs_reconnect boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE oauth_states (
    state_hash text PRIMARY KEY,
    redirect_uri text NOT NULL,
    access_level text NOT NULL CHECK (access_level IN ('public', 'private')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE auth_codes (
    code_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX sessions_user_idx ON sessions(user_id)`,

  // One row per (repo, branch, root): switching any of them makes every solution "unsynced"
  // for the new target, which triggers a backfill on the next sync.
  `CREATE TABLE repositories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    github_repo_id bigint NOT NULL,
    owner text NOT NULL,
    name text NOT NULL,
    is_private boolean NOT NULL,
    html_url text NOT NULL,
    branch text NOT NULL,
    root_dir text NOT NULL DEFAULT '',
    settings jsonb NOT NULL,
    is_active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, github_repo_id, branch, root_dir)
  )`,
  `CREATE UNIQUE INDEX repositories_one_active_idx ON repositories(user_id) WHERE is_active`,

  // Global LeetCode catalog. question_id is LeetCode's internal, title-independent id.
  `CREATE TABLE problems (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id text NOT NULL UNIQUE,
    frontend_id text NOT NULL,
    title text NOT NULL,
    title_slug text NOT NULL UNIQUE,
    difficulty text NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
    directory_name text NOT NULL,
    is_paid_only boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE topics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL
  )`,

  `CREATE TABLE problem_topics (
    problem_id uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    PRIMARY KEY (problem_id, topic_id)
  )`,

  `CREATE TABLE patterns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL
  )`,

  `CREATE TABLE custom_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug text NOT NULL,
    name text NOT NULL,
    UNIQUE (user_id, slug)
  )`,

  `CREATE TABLE user_problems (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    problem_id uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'new'
      CHECK (status IN ('new', 'solved', 'revised', 'need_revision', 'difficult', 'mastered')),
    notes text,
    time_complexity text,
    space_complexity text,
    attempt_count integer NOT NULL DEFAULT 0,
    accepted_count integer NOT NULL DEFAULT 0,
    wrong_answer_count integer NOT NULL DEFAULT 0,
    time_limit_exceeded_count integer NOT NULL DEFAULT 0,
    memory_limit_exceeded_count integer NOT NULL DEFAULT 0,
    runtime_error_count integer NOT NULL DEFAULT 0,
    compile_error_count integer NOT NULL DEFAULT 0,
    revision_count integer NOT NULL DEFAULT 0,
    first_solved_at timestamptz,
    last_solved_at timestamptz,
    last_revised_at timestamptz,
    metadata_dirty boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, problem_id)
  )`,

  `CREATE TABLE user_problem_patterns (
    user_problem_id uuid NOT NULL REFERENCES user_problems(id) ON DELETE CASCADE,
    pattern_id uuid NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
    PRIMARY KEY (user_problem_id, pattern_id)
  )`,

  `CREATE TABLE user_problem_tags (
    user_problem_id uuid NOT NULL REFERENCES user_problems(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES custom_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (user_problem_id, tag_id)
  )`,

  // Solution identity = (user problem, language).
  `CREATE TABLE solutions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_problem_id uuid NOT NULL REFERENCES user_problems(id) ON DELETE CASCADE,
    language text NOT NULL,
    code text NOT NULL,
    code_hash text NOT NULL,
    runtime text,
    memory text,
    runtime_ms integer,
    source_submission_id text NOT NULL,
    source_submitted_at timestamptz NOT NULL,
    synced_code_hash text,
    synced_repository_id uuid REFERENCES repositories(id) ON DELETE SET NULL,
    last_synced_at timestamptz,
    last_commit_sha text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_problem_id, language)
  )`,

  // UNIQUE (user_id, leetcode_submission_id) is what makes re-processing a submission harmless.
  `CREATE TABLE submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_problem_id uuid NOT NULL REFERENCES user_problems(id) ON DELETE CASCADE,
    leetcode_submission_id text NOT NULL,
    language text NOT NULL,
    status text NOT NULL,
    runtime text,
    memory text,
    runtime_ms integer,
    code text,
    code_hash text,
    submitted_at timestamptz NOT NULL,
    saved_attempt_path text,
    saved_attempt_kind text CHECK (saved_attempt_kind IN ('new_approach', 'important_revision', 'manual')),
    saved_attempt_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, leetcode_submission_id)
  )`,
  `CREATE INDEX submissions_user_problem_idx ON submissions(user_problem_id, submitted_at DESC)`,

  `CREATE TABLE revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_problem_id uuid NOT NULL REFERENCES user_problems(id) ON DELETE CASCADE,
    revision_type text NOT NULL CHECK (revision_type IN ('first_solve', 'resolve', 'manual', 'status_change')),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX revisions_user_problem_idx ON revisions(user_problem_id, created_at DESC)`,

  `CREATE TABLE sync_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repository_id uuid REFERENCES repositories(id) ON DELETE SET NULL,
    kind text NOT NULL CHECK (kind IN ('submission', 'metadata', 'full', 'attempt')),
    idempotency_key text NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    outcome text,
    change_kind text,
    message text,
    commit_sha text,
    commit_url text,
    problem_slug text,
    problem_title text,
    error_code text,
    error_message text,
    attempts integer NOT NULL DEFAULT 1,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    UNIQUE (user_id, idempotency_key)
  )`,
  `CREATE INDEX sync_jobs_user_created_idx ON sync_jobs(user_id, created_at DESC)`,
];

const DOWN = [
  'sync_jobs',
  'revisions',
  'submissions',
  'solutions',
  'user_problem_tags',
  'user_problem_patterns',
  'user_problems',
  'custom_tags',
  'patterns',
  'problem_topics',
  'topics',
  'problems',
  'repositories',
  'sessions',
  'auth_codes',
  'oauth_states',
  'github_accounts',
  'users',
];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of DOWN) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
