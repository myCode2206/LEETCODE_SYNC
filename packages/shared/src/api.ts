/**
 * Backend API contracts (/api/v1). Request bodies are zod schemas, validated by the backend and
 * used to type the extension's API client. Response DTOs are plain types.
 */
import { z } from 'zod';
import { DIFFICULTIES, SUBMISSION_STATUSES } from './status.js';
import { REVISION_STATUSES } from './revision.js';
import type { Difficulty, SubmissionStatus } from './status.js';
import type { RevisionStatus } from './revision.js';

export const API_PREFIX = '/api/v1';

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

const label = z.string().trim().min(1).max(60);

export const TopicSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(100),
});

export const MAX_CONTENT_LENGTH = 100_000;

export const ProblemInfoSchema = z.object({
  /** LeetCode internal question id (stable across title changes). */
  questionId: z.string().trim().min(1).max(32),
  /** Displayed problem number, e.g. "1" or "LCP 01". */
  frontendId: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(300),
  titleSlug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, 'titleSlug must be a LeetCode URL slug'),
  difficulty: z.enum(DIFFICULTIES),
  topics: z.array(TopicSchema).max(50).default([]),
  isPaidOnly: z.boolean().optional(),
  /** Problem statement as LeetCode's HTML. Optional: older clients do not send it. */
  content: z.string().max(MAX_CONTENT_LENGTH).nullish(),
});

export const MAX_CODE_LENGTH = 200_000;

export const SubmissionInfoSchema = z.object({
  leetcodeSubmissionId: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/, 'Invalid submission id'),
  status: z.enum(SUBMISSION_STATUSES),
  /** LeetCode language slug, e.g. "python3". */
  language: z.string().trim().min(1).max(40),
  /** Required for accepted submissions; omitted for failed ones (privacy + size). */
  code: z.string().max(MAX_CODE_LENGTH).optional(),
  /** SHA-256 of the code, used for failed submissions where code is not sent. */
  codeHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  runtime: z.string().max(40).nullish(),
  memory: z.string().max(40).nullish(),
  runtimeMs: z.number().int().nonnegative().nullish(),
  submittedAt: z.iso.datetime({ offset: true }),
});

export const SAVE_ATTEMPT_KINDS = ['new_approach', 'important_revision', 'manual'] as const;
export type SaveAttemptKind = (typeof SAVE_ATTEMPT_KINDS)[number];

export const SyncProblemRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
    problem: ProblemInfoSchema,
    submission: SubmissionInfoSchema,
    options: z
      .object({
        /** false = record in database only; commit later with "Push pending changes". */
        commit: z.boolean().default(true),
      })
      .default({ commit: true }),
  })
  .refine((v) => v.submission.status !== 'accepted' || !!v.submission.code?.trim(), {
    message: 'Accepted submissions must include code',
    path: ['submission', 'code'],
  });
export type SyncProblemRequest = z.infer<typeof SyncProblemRequestSchema>;
export type SyncProblemRequestInput = z.input<typeof SyncProblemRequestSchema>;

export const SOLUTION_UPDATE_POLICIES = ['latest', 'best_runtime', 'keep_first'] as const;
export type SolutionUpdatePolicy = (typeof SOLUTION_UPDATE_POLICIES)[number];

export const DEFAULT_COMMIT_TEMPLATE = 'leetcode: {action} #{id} {title}{languageSuffix}';

export const RepositorySettingsSchema = z.object({
  generateReadme: z.boolean().default(true),
  generateTopicIndexes: z.boolean().default(true),
  generatePatternIndexes: z.boolean().default(true),
  generateDifficultyIndexes: z.boolean().default(true),
  generateLanguageIndexes: z.boolean().default(true),
  generateStats: z.boolean().default(true),
  /** "latest": newest accepted code wins. "best_runtime": keep the fastest. "keep_first": never overwrite. */
  solutionUpdatePolicy: z.enum(SOLUTION_UPDATE_POLICIES).default('latest'),
  commitMessageTemplate: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((t) => t.includes('{title}') || t.includes('{id}'), {
      message: 'Commit message template must include {id} or {title}',
    })
    .default(DEFAULT_COMMIT_TEMPLATE),
  /** Commit when only counters/timestamps changed (identical resubmission). */
  commitMetadataOnlyChanges: z.boolean().default(false),
  suggestPatternsFromTopics: z.boolean().default(true),
  /**
   * Include the problem description in each problem README. Premium (paid-only) descriptions
   * are only included in private repositories.
   */
  includeProblemStatement: z.boolean().default(true),
});
export type RepositorySettings = z.infer<typeof RepositorySettingsSchema>;
export const DEFAULT_REPOSITORY_SETTINGS: RepositorySettings = RepositorySettingsSchema.parse({});

export const RepositoryConfigInputSchema = z.object({
  githubRepoId: z.number().int().positive(),
  branch: z.string().trim().min(1).max(250),
  rootDir: z.string().max(200).default(''),
  settings: RepositorySettingsSchema.default(DEFAULT_REPOSITORY_SETTINGS),
});
export type RepositoryConfigInput = z.input<typeof RepositoryConfigInputSchema>;

export const CreateRepositoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'Repository name may only contain letters, digits, ".", "_" and "-"',
    ),
  private: z.boolean(),
  description: z.string().max(300).optional(),
});
export type CreateRepositoryInput = z.infer<typeof CreateRepositoryInputSchema>;

export const UpdateProblemInputSchema = z.object({
  patterns: z.array(label).max(20).optional(),
  customTags: z.array(label).max(20).optional(),
  status: z.enum(REVISION_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
  timeComplexity: z.string().trim().max(60).nullable().optional(),
  spaceComplexity: z.string().trim().max(60).nullable().optional(),
});
export type UpdateProblemInput = z.infer<typeof UpdateProblemInputSchema>;

export const CreateRevisionInputSchema = z.object({
  problemSlug: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).optional(),
  status: z.enum(REVISION_STATUSES).optional(),
});
export type CreateRevisionInput = z.infer<typeof CreateRevisionInputSchema>;

export const SaveAttemptInputSchema = z.object({
  leetcodeSubmissionId: z.string().regex(/^\d{1,20}$/),
  kind: z.enum(SAVE_ATTEMPT_KINDS),
  note: z.string().max(500).optional(),
});
export type SaveAttemptInput = z.infer<typeof SaveAttemptInputSchema>;

export const TokenExchangeInputSchema = z.object({ code: z.string().min(16).max(200) });

export const GITHUB_ACCESS_LEVELS = ['public', 'private'] as const;
export type GitHubAccessLevel = (typeof GITHUB_ACCESS_LEVELS)[number];

export const ProblemListQuerySchema = z.object({
  q: z.string().max(100).optional(),
  topic: z.string().max(100).optional(),
  pattern: z.string().max(100).optional(),
  tag: z.string().max(100).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  language: z.string().max(40).optional(),
  status: z.enum(REVISION_STATUSES).optional(),
  due: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ProblemListQuery = z.infer<typeof ProblemListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface GitHubAccountDto {
  login: string;
  avatarUrl: string | null;
  scopes: string[];
  accessLevel: GitHubAccessLevel;
  needsReconnect: boolean;
}

export interface RepositoryConfigDto {
  id: string;
  githubRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  branch: string;
  rootDir: string;
  htmlUrl: string;
  settings: RepositorySettings;
}

export interface MeDto {
  userId: string;
  github: GitHubAccountDto | null;
  repository: RepositoryConfigDto | null;
}

export interface SessionDto {
  sessionToken: string;
  expiresAt: string;
  me: MeDto;
}

export interface GitHubRepoDto {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  canPush: boolean;
  htmlUrl: string;
}

export interface BranchDto {
  name: string;
  protected: boolean;
}

export type ChangeKind = 'new_problem' | 'new_language' | 'improved' | 'metadata' | 'none';

export type SyncOutcome =
  /** A commit was created. */
  | 'committed'
  /** Files were regenerated but identical to the branch: nothing to commit. */
  | 'up_to_date'
  /** Recorded in the database only (identical code, failed submission, or commit disabled). */
  | 'recorded';

export interface SyncResultDto {
  jobId: string;
  outcome: SyncOutcome;
  /** True when this idempotency key was already processed; result is the stored one. */
  duplicate: boolean;
  changeKind: ChangeKind;
  commitSha: string | null;
  commitUrl: string | null;
  message: string;
  problem: { slug: string; frontendId: string; title: string } | null;
}

export interface TopicRefDto {
  name: string;
  slug: string;
}

export interface ProblemSummaryDto {
  slug: string;
  frontendId: string;
  title: string;
  difficulty: Difficulty;
  topics: TopicRefDto[];
  patterns: string[];
  customTags: string[];
  /** Language keys, e.g. ["cpp", "python3"]. */
  languages: string[];
  status: RevisionStatus;
  attemptCount: number;
  acceptedCount: number;
  revisionCount: number;
  firstSolvedAt: string | null;
  lastSolvedAt: string | null;
  lastRevisedAt: string | null;
  dueAt: string | null;
  isDue: boolean;
  leetcodeUrl: string;
  githubUrl: string | null;
}

export interface SolutionDto {
  language: string;
  displayName: string;
  runtime: string | null;
  memory: string | null;
  updatedAt: string;
  githubUrl: string | null;
  synced: boolean;
}

export interface SubmissionDto {
  leetcodeSubmissionId: string;
  status: SubmissionStatus;
  language: string;
  runtime: string | null;
  memory: string | null;
  submittedAt: string;
  savedAttemptPath: string | null;
  hasCode: boolean;
}

export type RevisionType = 'first_solve' | 'resolve' | 'manual' | 'status_change';

export interface RevisionDto {
  id: string;
  type: RevisionType;
  notes: string | null;
  createdAt: string;
}

export interface ProblemDetailDto extends ProblemSummaryDto {
  notes: string | null;
  timeComplexity: string | null;
  spaceComplexity: string | null;
  wrongAnswerCount: number;
  timeLimitExceededCount: number;
  memoryLimitExceededCount: number;
  runtimeErrorCount: number;
  compileErrorCount: number;
  solutions: SolutionDto[];
  submissions: SubmissionDto[];
  revisions: RevisionDto[];
}

export interface CategoryCountDto {
  name: string;
  slug: string;
  count: number;
  easy: number;
  medium: number;
  hard: number;
}

export type SyncJobKind = 'submission' | 'metadata' | 'full' | 'attempt';
export type SyncJobStatus = 'running' | 'succeeded' | 'failed';

export interface SyncJobDto {
  id: string;
  kind: SyncJobKind;
  status: SyncJobStatus;
  outcome: SyncOutcome | null;
  message: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  problemSlug: string | null;
  problemTitle: string | null;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface StatsDto {
  total: number;
  easy: number;
  medium: number;
  hard: number;
  topics: CategoryCountDto[];
  patterns: CategoryCountDto[];
  languages: CategoryCountDto[];
  customTags: CategoryCountDto[];
  dueCount: number;
  pendingCommitCount: number;
  recentSyncs: SyncJobDto[];
}
