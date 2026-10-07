/** Read-only access to LeetCode's GraphQL API from the leetcode.com content script (same origin). */

export interface QuestionData {
  questionId: string;
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  isPaidOnly: boolean;
  /** Problem statement (HTML); null for premium problems the user cannot access. */
  content: string | null;
  topicTags: { name: string; slug: string }[];
}

export interface SubmissionDetails {
  code: string;
  /** Unix seconds. */
  timestamp: number | null;
  statusCode: number | null;
  lang: string | null;
  questionId: string | null;
  titleSlug: string | null;
}

export interface LeetCodeApi {
  fetchQuestion(titleSlug: string): Promise<QuestionData>;
  fetchSubmissionDetails(submissionId: string): Promise<SubmissionDetails | null>;
}

export const QUESTION_QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId questionFrontendId title titleSlug difficulty isPaidOnly content
    topicTags { name slug }
  }
}`;

// Deliberately minimal: fewer fields means fewer ways for a schema change to break the query.
export const SUBMISSION_DETAILS_QUERY = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    code timestamp statusCode
    lang { name }
    question { questionId titleSlug }
  }
}`;

export class LeetCodeApiError extends Error {}

function readCsrfToken(cookie: string): string | null {
  return /(?:^|;\s*)csrftoken=([^;]+)/.exec(cookie)?.[1] ?? null;
}

export function createLeetCodeApi(
  fetchImpl: typeof fetch = fetch,
  getCookie: () => string = () => document.cookie,
  endpoint = 'https://leetcode.com/graphql/',
): LeetCodeApi {
  const questionCache = new Map<string, QuestionData>();

  async function query<T>(
    operationName: string,
    q: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const csrf = readCsrfToken(getCookie());
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrftoken': csrf } : {}) },
      body: JSON.stringify({ operationName, query: q, variables }),
    });
    if (!res.ok) throw new LeetCodeApiError(`LeetCode GraphQL returned ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length || !body.data) {
      throw new LeetCodeApiError(body.errors?.[0]?.message ?? 'LeetCode GraphQL returned no data');
    }
    return body.data;
  }

  return {
    async fetchQuestion(titleSlug) {
      const cached = questionCache.get(titleSlug);
      if (cached) return cached;
      const data = await query<{ question: QuestionData | null }>('questionData', QUESTION_QUERY, {
        titleSlug,
      });
      if (!data.question)
        throw new LeetCodeApiError(`Problem "${titleSlug}" not found on LeetCode`);
      questionCache.set(titleSlug, data.question);
      return data.question;
    },

    async fetchSubmissionDetails(submissionId) {
      const data = await query<{
        submissionDetails: {
          code?: string;
          timestamp?: number | string;
          statusCode?: number;
          lang?: { name?: string } | null;
          question?: { questionId?: string; titleSlug?: string } | null;
        } | null;
      }>('submissionDetails', SUBMISSION_DETAILS_QUERY, { submissionId: Number(submissionId) });
      const d = data.submissionDetails;
      if (!d || typeof d.code !== 'string') return null;
      return {
        code: d.code,
        timestamp:
          d.timestamp != null && Number.isFinite(Number(d.timestamp)) ? Number(d.timestamp) : null,
        statusCode: typeof d.statusCode === 'number' ? d.statusCode : null,
        lang: d.lang?.name ?? null,
        questionId: d.question?.questionId ?? null,
        titleSlug: d.question?.titleSlug ?? null,
      };
    },
  };
}
