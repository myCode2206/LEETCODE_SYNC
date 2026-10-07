import { REVISION_STATUSES } from '@lcsync/shared';
import { categoriesOf } from './index-files.js';
import type { ProblemRecord } from './types.js';

function counts(
  problems: ProblemRecord[],
  kind: 'topics' | 'patterns' | 'languages',
): Record<string, number> {
  return Object.fromEntries(categoriesOf(kind, problems).map((c) => [c.name, c.items.length]));
}

/** Machine-readable statistics. Contains no generation timestamp so unchanged data = unchanged file. */
export function statsJson(problems: ProblemRecord[]): string {
  const stats = {
    schemaVersion: 1,
    totalSolved: problems.length,
    byDifficulty: {
      Easy: problems.filter((p) => p.difficulty === 'Easy').length,
      Medium: problems.filter((p) => p.difficulty === 'Medium').length,
      Hard: problems.filter((p) => p.difficulty === 'Hard').length,
    },
    byStatus: Object.fromEntries(
      REVISION_STATUSES.map((s) => [s, problems.filter((p) => p.status === s).length]),
    ),
    byTopic: counts(problems, 'topics'),
    byPattern: counts(problems, 'patterns'),
    byLanguage: counts(problems, 'languages'),
    totals: {
      attempts: problems.reduce((n, p) => n + p.counts.attempts, 0),
      accepted: problems.reduce((n, p) => n + p.counts.accepted, 0),
      revisions: problems.reduce((n, p) => n + p.counts.revisions, 0),
    },
  };
  return JSON.stringify(stats, null, 2) + '\n';
}
