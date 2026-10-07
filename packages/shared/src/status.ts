export const SUBMISSION_STATUSES = [
  'accepted',
  'wrong_answer',
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'output_limit_exceeded',
  'runtime_error',
  'compile_error',
  'internal_error',
  'unknown',
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** LeetCode `status_code` values returned by /submissions/detail/<id>/check/. */
const STATUS_BY_CODE: Record<number, SubmissionStatus> = {
  10: 'accepted',
  11: 'wrong_answer',
  12: 'memory_limit_exceeded',
  13: 'output_limit_exceeded',
  14: 'time_limit_exceeded',
  15: 'runtime_error',
  16: 'internal_error',
  20: 'compile_error',
};

const STATUS_BY_MESSAGE: Record<string, SubmissionStatus> = {
  accepted: 'accepted',
  'wrong answer': 'wrong_answer',
  'memory limit exceeded': 'memory_limit_exceeded',
  'output limit exceeded': 'output_limit_exceeded',
  'time limit exceeded': 'time_limit_exceeded',
  'runtime error': 'runtime_error',
  'compile error': 'compile_error',
  'internal error': 'internal_error',
};

/** Maps LeetCode's numeric code (preferred) or message to a status. */
export function mapLeetCodeStatus(
  code: number | null | undefined,
  message?: string | null,
): SubmissionStatus {
  if (typeof code === 'number' && STATUS_BY_CODE[code]) return STATUS_BY_CODE[code];
  if (message) return STATUS_BY_MESSAGE[message.trim().toLowerCase()] ?? 'unknown';
  return 'unknown';
}

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  accepted: 'Accepted',
  wrong_answer: 'Wrong Answer',
  time_limit_exceeded: 'Time Limit Exceeded',
  memory_limit_exceeded: 'Memory Limit Exceeded',
  output_limit_exceeded: 'Output Limit Exceeded',
  runtime_error: 'Runtime Error',
  compile_error: 'Compilation Error',
  internal_error: 'Internal Error',
  unknown: 'Unknown',
};

export function normalizeDifficulty(raw: string): Difficulty {
  const found = DIFFICULTIES.find((d) => d.toLowerCase() === raw.trim().toLowerCase());
  if (!found) throw new Error(`Unknown difficulty "${raw}"`);
  return found;
}
