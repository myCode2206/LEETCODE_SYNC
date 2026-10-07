import { mapLeetCodeStatus, normalizeDifficulty } from '@lcsync/shared';
import type { SyncProblemRequestInput } from '@lcsync/shared';
import type { LeetCodeApi } from './graphql.js';
import type { CheckEvent, SubmitEvent } from './protocol.js';

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export interface AssembleInput {
  submit: SubmitEvent | null;
  check: CheckEvent;
  /** Slug from the current page URL, used if the submit request was not observed. */
  pageSlug: string | null;
  api: LeetCodeApi;
  sha256: (text: string) => Promise<string>;
  now: () => Date;
}

/** /problems/two-sum/description/ → "two-sum" */
export function slugFromPath(pathname: string): string | null {
  return /^\/problems\/([a-z0-9-]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * Turns observed network events into a sync request. Accepted submissions are confirmed via
 * LeetCode's submissionDetails query when available (source of truth for code and status);
 * otherwise the code captured from the submit request is used. Failed submissions never carry
 * code — only its hash.
 */
export async function assembleSubmission(input: AssembleInput): Promise<SyncProblemRequestInput> {
  const { submit, check, api } = input;
  const submissionId = check.submissionId;
  let status = mapLeetCodeStatus(check.statusCode, check.statusMessage);

  let details = null;
  if (status === 'accepted') {
    details = await api.fetchSubmissionDetails(submissionId).catch(() => null);
    if (details?.statusCode != null) status = mapLeetCodeStatus(details.statusCode);
  }

  const slug = details?.titleSlug ?? submit?.slug ?? input.pageSlug;
  if (!slug) throw new ExtractionError('Could not determine which LeetCode problem was submitted.');

  const code = details?.code ?? submit?.code ?? null;
  if (status === 'accepted' && !code?.trim()) {
    throw new ExtractionError(
      'Could not extract the submitted code. Reload the problem page and submit again.',
    );
  }

  const language = details?.lang ?? check.lang ?? submit?.lang;
  if (!language) throw new ExtractionError('Could not determine the submission language.');

  let question;
  try {
    question = await input.api.fetchQuestion(slug);
  } catch (err) {
    throw new ExtractionError(
      `Could not load problem details from LeetCode: ${(err as Error).message}`,
    );
  }

  const submittedAt = details?.timestamp
    ? new Date(details.timestamp * 1000)
    : check.finishedAt
      ? new Date(check.finishedAt)
      : input.now();

  const accepted = status === 'accepted';
  return {
    idempotencyKey: `submission:${submissionId}`,
    problem: {
      questionId: question.questionId,
      frontendId: question.questionFrontendId,
      title: question.title,
      titleSlug: question.titleSlug,
      difficulty: normalizeDifficulty(question.difficulty),
      topics: question.topicTags.map((t) => ({ name: t.name, slug: t.slug })),
      isPaidOnly: question.isPaidOnly,
    },
    submission: {
      leetcodeSubmissionId: submissionId,
      status,
      language,
      ...(accepted ? { code: code! } : code ? { codeHash: await input.sha256(code) } : {}),
      runtime: check.runtime,
      memory: check.memory,
      runtimeMs: check.runtimeMs,
      submittedAt: submittedAt.toISOString(),
    },
  };
}
