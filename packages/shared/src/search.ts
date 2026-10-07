import type { ProblemSummaryDto } from './api.js';
import { getLanguage } from './languages.js';
import { REVISION_STATUS_LABELS } from './revision.js';
import type { RevisionStatus } from './revision.js';
import { slugify } from './problem-format.js';
import type { Difficulty } from './status.js';

export interface ProblemFilters {
  q?: string;
  topic?: string;
  pattern?: string;
  tag?: string;
  difficulty?: Difficulty;
  language?: string;
  status?: RevisionStatus;
  due?: boolean;
}

/** All strings a problem can be found by: number, title, topics, patterns, tags, languages, difficulty, status. */
function searchableTerms(p: ProblemSummaryDto): string[] {
  return [
    p.frontendId,
    `#${p.frontendId}`,
    p.title,
    p.slug,
    p.difficulty,
    REVISION_STATUS_LABELS[p.status],
    ...p.topics.flatMap((t) => [t.name, t.slug]),
    ...p.patterns,
    ...p.customTags,
    ...p.languages.flatMap((l) => [l, getLanguage(l).displayName]),
  ].map((s) => s.toLowerCase());
}

/**
 * Free-text search. A purely numeric query matches the problem number exactly ("1" finds
 * Two Sum, not every title containing 1); otherwise every word must match some term.
 */
export function matchesQuery(p: ProblemSummaryDto, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  if (/^\d+$/.test(q)) return p.frontendId === q || p.frontendId === String(Number(q));
  const terms = searchableTerms(p);
  const haystack = terms.join(' | ');
  // Whole-phrase match first ("sliding window"), then every word anywhere.
  if (haystack.includes(q)) return true;
  return q.split(/\s+/).every((word) => terms.some((t) => t.includes(word)));
}

const eqSlug = (a: string, b: string) => slugify(a) === slugify(b);

export function filterProblems(
  problems: readonly ProblemSummaryDto[],
  f: ProblemFilters,
): ProblemSummaryDto[] {
  return problems.filter(
    (p) =>
      (!f.q || matchesQuery(p, f.q)) &&
      (!f.topic || p.topics.some((t) => t.slug === f.topic || eqSlug(t.name, f.topic!))) &&
      (!f.pattern || p.patterns.some((x) => eqSlug(x, f.pattern!))) &&
      (!f.tag || p.customTags.some((x) => eqSlug(x, f.tag!))) &&
      (!f.difficulty || p.difficulty === f.difficulty) &&
      (!f.language ||
        p.languages.some((l) => l === f.language || getLanguage(l).indexSlug === f.language)) &&
      (!f.status || p.status === f.status) &&
      (f.due === undefined || p.isDue === f.due),
  );
}

/** Numeric problem order (1, 2, 15, 206 …), non-numeric ids last. */
export function compareByProblemNumber(
  a: { frontendId: string },
  b: { frontendId: string },
): number {
  const na = /^\d+$/.test(a.frontendId) ? Number(a.frontendId) : Number.POSITIVE_INFINITY;
  const nb = /^\d+$/.test(b.frontendId) ? Number(b.frontendId) : Number.POSITIVE_INFINITY;
  return na - nb || a.frontendId.localeCompare(b.frontendId);
}
