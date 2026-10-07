import { describe, expect, it, vi } from 'vitest';
import { assembleSubmission, slugFromPath } from '../src/leetcode/assembler.js';
import type { LeetCodeApi, QuestionData } from '../src/leetcode/graphql.js';
import { createLeetCodeApi } from '../src/leetcode/graphql.js';
import {
  matchCheckUrl,
  matchSubmitUrl,
  parseCheck,
  parseRuntimeMs,
  parseSubmit,
} from '../src/leetcode/interceptor.js';
import { installPageHook } from '../src/leetcode/page-hook-core.js';
import type { CheckEvent, HookMessage, SubmitEvent } from '../src/leetcode/protocol.js';
import { pollForResult } from '../src/leetcode/result-poller.js';
import { SubmissionTracker } from '../src/leetcode/submission-tracker.js';

// Recorded shapes of LeetCode responses (trimmed).
const SUBMIT_BODY = JSON.stringify({
  lang: 'python3',
  question_id: '1',
  typed_code: 'class Solution: ...',
});
const SUBMIT_RESPONSE = JSON.stringify({ submission_id: 1234567890 });
const CHECK_PENDING = JSON.stringify({ state: 'STARTED' });
const CHECK_ACCEPTED = JSON.stringify({
  state: 'SUCCESS',
  status_code: 10,
  status_msg: 'Accepted',
  lang: 'python3',
  question_id: '1',
  status_runtime: '3 ms',
  status_memory: '17.9 MB',
  task_finish_time: 1791367200000,
  finished: true,
});
const CHECK_WRONG = JSON.stringify({
  state: 'SUCCESS',
  status_code: 11,
  status_msg: 'Wrong Answer',
  lang: 'cpp',
});

const TWO_SUM: QuestionData = {
  questionId: '1',
  questionFrontendId: '1',
  title: 'Two Sum',
  titleSlug: 'two-sum',
  difficulty: 'Easy',
  isPaidOnly: false,
  content: '<p>Given an array of integers <code>nums</code>…</p>',
  topicTags: [
    { name: 'Array', slug: 'array' },
    { name: 'Hash Table', slug: 'hash-table' },
  ],
};

describe('URL matching', () => {
  it('recognises submit and check endpoints only', () => {
    expect(matchSubmitUrl('https://leetcode.com/problems/two-sum/submit/')).toBe('two-sum');
    expect(matchSubmitUrl('https://leetcode.com/problems/two-sum/interpret_solution/')).toBeNull();
    expect(matchCheckUrl('https://leetcode.com/submissions/detail/1234567890/check/')).toBe(
      '1234567890',
    );
    // "Run code" checks use non-numeric ids and must be ignored.
    expect(
      matchCheckUrl('https://leetcode.com/submissions/detail/runcode_1700000000.123_abc/check/'),
    ).toBeNull();
    expect(matchCheckUrl('https://evil.com/submissions/detail/1/check/')).toBeNull();
    // LeetCode's current endpoint (seen live, 2026-10) has a version segment.
    expect(matchCheckUrl('https://leetcode.com/submissions/detail/2165707846/v2/check/')).toBe(
      '2165707846',
    );
    expect(
      matchCheckUrl('https://leetcode.com/submissions/detail/runcode_1.2_x/v2/check/'),
    ).toBeNull();
  });
});

describe('response parsing', () => {
  it('parses the submit request and response', () => {
    expect(parseSubmit('two-sum', SUBMIT_BODY, SUBMIT_RESPONSE)).toEqual<SubmitEvent>({
      kind: 'submit',
      slug: 'two-sum',
      submissionId: '1234567890',
      lang: 'python3',
      questionId: '1',
      code: 'class Solution: ...',
    });
    expect(parseSubmit('two-sum', SUBMIT_BODY, '{"error":"rate limited"}')).toBeNull();
  });

  it('ignores in-progress checks and parses final ones', () => {
    expect(parseCheck('1', CHECK_PENDING)).toBeNull();
    expect(parseCheck('1', 'not json')).toBeNull();
    expect(parseCheck('1234567890', CHECK_ACCEPTED)).toMatchObject({
      statusCode: 10,
      runtime: '3 ms',
      runtimeMs: 3,
      memory: '17.9 MB',
      finishedAt: 1791367200000,
    });
  });

  it('parses runtimes', () => {
    expect(parseRuntimeMs('0 ms')).toBe(0);
    expect(parseRuntimeMs('1.5 s')).toBe(1500);
    expect(parseRuntimeMs('N/A')).toBeNull();
  });

  it('extracts the slug from page paths', () => {
    expect(slugFromPath('/problems/two-sum/description/')).toBe('two-sum');
    expect(slugFromPath('/problemset/')).toBeNull();
  });
});

describe('SubmissionTracker', () => {
  const submit = parseSubmit('two-sum', SUBMIT_BODY, SUBMIT_RESPONSE)!;
  const check = parseCheck('1234567890', CHECK_ACCEPTED)!;

  it('correlates submit and check and handles each submission once', () => {
    const t = new SubmissionTracker();
    t.onSubmit(submit);
    expect(t.onCheck(check)).toEqual({ submit, check });
    expect(t.onCheck(check)).toBeNull(); // LeetCode polls repeatedly
  });

  it('works when the submit request was not observed', () => {
    expect(new SubmissionTracker().onCheck(check)).toEqual({ submit: null, check });
  });
});

function fakeApi(overrides: Partial<LeetCodeApi> = {}): LeetCodeApi {
  return {
    fetchQuestion: async () => TWO_SUM,
    fetchSubmissionDetails: async () => ({
      code: 'class Solution:\n    verified = True\n',
      timestamp: 1791367100,
      statusCode: 10,
      lang: 'python3',
      questionId: '1',
      titleSlug: 'two-sum',
    }),
    ...overrides,
  };
}

const sha256 = async (s: string) => `hash(${s.length})`.padEnd(64, '0');
const now = () => new Date('2026-10-07T10:00:00Z');

describe('assembleSubmission', () => {
  const submit = parseSubmit('two-sum', SUBMIT_BODY, SUBMIT_RESPONSE)!;
  const accepted = parseCheck('1234567890', CHECK_ACCEPTED)!;

  it('builds a complete request, preferring LeetCode-confirmed data', async () => {
    const req = await assembleSubmission({
      submit,
      check: accepted,
      pageSlug: null,
      api: fakeApi(),
      sha256,
      now,
    });
    expect(req).toEqual({
      idempotencyKey: 'submission:1234567890',
      problem: {
        questionId: '1',
        frontendId: '1',
        title: 'Two Sum',
        titleSlug: 'two-sum',
        difficulty: 'Easy',
        topics: [
          { name: 'Array', slug: 'array' },
          { name: 'Hash Table', slug: 'hash-table' },
        ],
        isPaidOnly: false,
        content: '<p>Given an array of integers <code>nums</code>…</p>',
      },
      submission: {
        leetcodeSubmissionId: '1234567890',
        status: 'accepted',
        language: 'python3',
        code: 'class Solution:\n    verified = True\n',
        runtime: '3 ms',
        memory: '17.9 MB',
        runtimeMs: 3,
        submittedAt: '2026-10-07T09:58:20.000Z',
      },
    });
  });

  it('falls back to the observed request when submissionDetails is unavailable', async () => {
    const api = fakeApi({
      fetchSubmissionDetails: async () => Promise.reject(new Error('schema changed')),
    });
    const req = await assembleSubmission({
      submit,
      check: accepted,
      pageSlug: null,
      api,
      sha256,
      now,
    });
    expect(req.submission.code).toBe('class Solution: ...');
    expect(req.submission.submittedAt).toBe(new Date(1791367200000).toISOString());
  });

  it('fails clearly when code cannot be extracted', async () => {
    const api = fakeApi({ fetchSubmissionDetails: async () => null });
    await expect(
      assembleSubmission({ submit: null, check: accepted, pageSlug: 'two-sum', api, sha256, now }),
    ).rejects.toThrow('Could not extract the submitted code');
  });

  it('never includes code for failed submissions', async () => {
    const wrong = parseCheck('99', CHECK_WRONG)!;
    const req = await assembleSubmission({
      submit: { ...submit, submissionId: '99', lang: 'cpp', code: 'int main(){}' },
      check: wrong,
      pageSlug: null,
      api: fakeApi(),
      sha256,
      now,
    });
    expect(req.submission.status).toBe('wrong_answer');
    expect(req.submission.code).toBeUndefined();
    expect(req.submission.codeHash).toHaveLength(64);
  });
});

describe('LeetCode GraphQL client', () => {
  it('sends the CSRF token and caches question metadata', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: { question: TWO_SUM } })),
    );
    const api = createLeetCodeApi(
      fetchImpl as unknown as typeof fetch,
      () => 'a=1; csrftoken=tok123; b=2',
    );
    expect(await api.fetchQuestion('two-sum')).toEqual(TWO_SUM);
    await api.fetchQuestion('two-sum');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['x-csrftoken']).toBe('tok123');
  });

  it('surfaces GraphQL errors', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "x"' }] }));
    const api = createLeetCodeApi(fetchImpl as unknown as typeof fetch, () => '');
    await expect(api.fetchSubmissionDetails('1')).rejects.toThrow('Cannot query field');
  });
});

describe('page hook', () => {
  function fakeWindow(responses: Record<string, string>) {
    const messages: HookMessage[] = [];
    function FakeXHR() {}
    FakeXHR.prototype.open = () => {};
    FakeXHR.prototype.send = () => {};
    const win = {
      location: { origin: 'https://leetcode.com', href: 'https://leetcode.com/problems/two-sum/' },
      postMessage: (m: HookMessage) => messages.push(m),
      fetch: async (input: string) =>
        new Response(responses[new URL(input, 'https://leetcode.com/').toString()] ?? '{}'),
      XMLHttpRequest: FakeXHR,
    };
    return { win: win as unknown as Window & typeof globalThis, messages };
  }

  it('observes fetch submissions without altering responses', async () => {
    const { win, messages } = fakeWindow({
      'https://leetcode.com/problems/two-sum/submit/': SUBMIT_RESPONSE,
      'https://leetcode.com/submissions/detail/1234567890/check/': CHECK_ACCEPTED,
    });
    installPageHook(win);
    installPageHook(win); // idempotent

    const submitRes = await win.fetch('/problems/two-sum/submit/', {
      method: 'POST',
      body: SUBMIT_BODY,
    });
    expect(await submitRes.text()).toBe(SUBMIT_RESPONSE);
    const checkRes = await win.fetch('/submissions/detail/1234567890/check/');
    expect(JSON.parse(await checkRes.text()).status_code).toBe(10);
    await new Promise((r) => setTimeout(r, 10));

    expect(messages.map((m) => m.event.kind)).toEqual(['submit', 'check']);
    expect((messages[0]!.event as SubmitEvent).code).toBe('class Solution: ...');
    expect((messages[1]!.event as CheckEvent).statusCode).toBe(10);
  });

  it('ignores unrelated requests', async () => {
    const { win, messages } = fakeWindow({});
    installPageHook(win);
    await win.fetch('https://leetcode.com/graphql/');
    await new Promise((r) => setTimeout(r, 10));
    expect(messages).toEqual([]);
  });
});

describe('pollForResult (backup detection)', () => {
  const sleep = async () => {};
  const details = (statusCode: number | null) => ({
    code: 'x',
    timestamp: 1791402132,
    statusCode,
    lang: 'python3',
    questionId: '301',
    titleSlug: 'remove-invalid-parentheses',
  });

  it('polls until LeetCode reports a final verdict', async () => {
    const answers = [null, details(null), details(10)];
    const api = { fetchSubmissionDetails: vi.fn(async () => answers.shift() ?? null) };
    const check = await pollForResult('2165707846', { api, isHandled: () => false, sleep });
    expect(api.fetchSubmissionDetails).toHaveBeenCalledTimes(3);
    expect(check).toMatchObject({
      submissionId: '2165707846',
      statusCode: 10,
      lang: 'python3',
      finishedAt: 1791402132000,
    });
  });

  it('stops when the result was already observed on the network', async () => {
    const api = { fetchSubmissionDetails: vi.fn(async () => details(10)) };
    expect(await pollForResult('1', { api, isHandled: () => true, sleep })).toBeNull();
    expect(api.fetchSubmissionDetails).not.toHaveBeenCalled();
  });

  it('gives up after the configured attempts', async () => {
    const api = { fetchSubmissionDetails: vi.fn(async () => Promise.reject(new Error('down'))) };
    expect(
      await pollForResult('1', { api, isHandled: () => false, sleep, attempts: 3 }),
    ).toBeNull();
    expect(api.fetchSubmissionDetails).toHaveBeenCalledTimes(3);
  });
});
