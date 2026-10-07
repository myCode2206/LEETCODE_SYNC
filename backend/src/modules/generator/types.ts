import type {
  Difficulty,
  RepositorySettings,
  RevisionStatus,
  SaveAttemptKind,
} from '@lcsync/shared';

/** Everything the generator needs about one problem. Built from the database. */
export interface ProblemRecord {
  userProblemId: string;
  questionId: string;
  frontendId: string;
  title: string;
  titleSlug: string;
  difficulty: Difficulty;
  directoryName: string;
  topics: { name: string; slug: string }[];
  patterns: string[];
  customTags: string[];
  status: RevisionStatus;
  notes: string | null;
  timeComplexity: string | null;
  spaceComplexity: string | null;
  counts: {
    attempts: number;
    accepted: number;
    wrongAnswer: number;
    timeLimitExceeded: number;
    memoryLimitExceeded: number;
    runtimeError: number;
    compileError: number;
    revisions: number;
  };
  firstSolvedAt: Date | null;
  lastSolvedAt: Date | null;
  lastRevisedAt: Date | null;
  solutions: SolutionRecord[];
  savedAttempts: SavedAttemptRecord[];
}

export interface SolutionRecord {
  language: string;
  code: string;
  runtime: string | null;
  memory: string | null;
  updatedAt: Date;
}

export interface SavedAttemptRecord {
  /** Path relative to the problem directory, e.g. "attempts/2026-10-01-python.py". */
  path: string;
  language: string;
  code: string;
  kind: SaveAttemptKind;
  note: string | null;
  submittedAt: Date;
}

export interface GeneratorOptions {
  settings: RepositorySettings;
  rootDir: string;
}

export interface GeneratedFile {
  /** Path relative to the repository root (root directory already applied). */
  path: string;
  content: string;
}
