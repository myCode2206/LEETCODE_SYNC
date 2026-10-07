import { formatProblemId } from '@lcsync/shared';
import type { ProblemRecord } from './types.js';

/** Escapes characters that would break Markdown link text or table cells. */
export function escapeMd(text: string): string {
  return text.replace(/([\\[\]|*_`<>])/g, '\\$1');
}

/** A code fence longer than any backtick run inside the code. */
export function codeBlock(code: string, lang: string): string {
  const longestRun = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}${lang}\n${code.replace(/\s+$/, '')}\n${fence}`;
}

export function table(headers: string[], align: ('l' | 'r')[], rows: string[][]): string {
  const sep = align.map((a) => (a === 'r' ? '---:' : '---'));
  return [headers, sep, ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
}

/** Numeric ids first in numeric order, then other ids alphabetically. */
export function compareProblems(a: ProblemRecord, b: ProblemRecord): number {
  const na = /^\d+$/.test(a.frontendId) ? Number(a.frontendId) : Number.POSITIVE_INFINITY;
  const nb = /^\d+$/.test(b.frontendId) ? Number(b.frontendId) : Number.POSITIVE_INFINITY;
  if (na !== nb) return na - nb;
  return formatProblemId(a.frontendId).localeCompare(formatProblemId(b.frontendId));
}

/** "1. Two Sum" */
export function problemLabel(p: ProblemRecord): string {
  return `${p.frontendId}. ${escapeMd(p.title)}`;
}

export function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
