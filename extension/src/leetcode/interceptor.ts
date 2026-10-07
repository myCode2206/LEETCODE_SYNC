import { CHECK_URL, SUBMIT_URL } from './protocol.js';
import type { CheckEvent, SubmitEvent } from './protocol.js';

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseJson(text: string | null | undefined): Json | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
}

export function matchSubmitUrl(url: string): string | null {
  return SUBMIT_URL.exec(url)?.[1] ?? null;
}

export function matchCheckUrl(url: string): string | null {
  return CHECK_URL.exec(url)?.[1] ?? null;
}

/** Builds a submit event from the request body ({lang, question_id, typed_code}) and response ({submission_id}). */
export function parseSubmit(
  slug: string,
  requestBody: string | null,
  responseBody: string | null,
): SubmitEvent | null {
  const res = parseJson(responseBody);
  const id = res?.submission_id;
  const submissionId =
    typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)) ? String(id) : null;
  if (!submissionId) return null;
  const req = parseJson(requestBody);
  return {
    kind: 'submit',
    slug,
    submissionId,
    lang: str(req?.lang),
    questionId: req?.question_id != null ? String(req.question_id) : null,
    code: str(req?.typed_code),
  };
}

/** "3 ms" → 3, "1.2 s" → 1200. */
export function parseRuntimeMs(display: string | null): number | null {
  if (!display) return null;
  const m = /^([\d.]+)\s*(ms|s)$/i.exec(display.trim());
  if (!m) return null;
  const value = Number(m[1]);
  return Math.round(m[2]!.toLowerCase() === 's' ? value * 1000 : value);
}

/** Parses the polling response; returns null until the judge has finished (state !== "SUCCESS"). */
export function parseCheck(submissionId: string, responseBody: string | null): CheckEvent | null {
  const res = parseJson(responseBody);
  if (!res || res.state !== 'SUCCESS') return null;
  const runtime = str(res.status_runtime);
  return {
    kind: 'check',
    submissionId,
    statusCode: num(res.status_code),
    statusMessage: str(res.status_msg),
    lang: str(res.lang),
    questionId: res.question_id != null ? String(res.question_id) : null,
    runtime,
    memory: str(res.status_memory),
    runtimeMs: parseRuntimeMs(runtime),
    finishedAt: num(res.task_finish_time),
  };
}
