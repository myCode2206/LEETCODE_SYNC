import { getLanguage, leetcodeProblemUrl, REVISION_STATUS_LABELS, slugify } from '@lcsync/shared';
import { codeBlock, escapeMd, isoDate } from './markdown.js';
import type { GeneratorOptions, ProblemRecord } from './types.js';

export const METADATA_SCHEMA_VERSION = 1;

export function sortedSolutions(p: ProblemRecord) {
  return [...p.solutions].sort((a, b) =>
    getLanguage(a.language).displayName.localeCompare(getLanguage(b.language).displayName),
  );
}

/** Files that live inside the canonical problem directory, relative to that directory. */
export function problemFiles(
  p: ProblemRecord,
  opts: GeneratorOptions,
): { path: string; content: string }[] {
  const files = [
    { path: 'README.md', content: problemReadme(p, opts) },
    { path: 'metadata.json', content: problemMetadataJson(p) },
  ];
  for (const s of sortedSolutions(p)) {
    files.push({
      path: `solutions/${getLanguage(s.language).fileName}`,
      content: ensureTrailingNewline(s.code),
    });
  }
  for (const a of p.savedAttempts) {
    files.push({ path: a.path, content: ensureTrailingNewline(a.code) });
  }
  return files;
}

function ensureTrailingNewline(code: string): string {
  return code.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}

function linkList(items: { name: string; href: string | null }[]): string {
  return items
    .map((i) => (i.href ? `- [${escapeMd(i.name)}](${i.href})` : `- ${escapeMd(i.name)}`))
    .join('\n');
}

export function problemReadme(p: ProblemRecord, opts: GeneratorOptions): string {
  const { settings } = opts;
  const lines: string[] = [];
  lines.push(`# ${p.frontendId}. ${escapeMd(p.title)}`, '');
  lines.push(`**LeetCode:** [#${p.frontendId}](${leetcodeProblemUrl(p.titleSlug)})`, '');
  lines.push(`**Difficulty:** ${p.difficulty}`, '');

  if (p.topics.length) {
    lines.push('**Topics:**', '');
    lines.push(
      linkList(
        p.topics.map((t) => ({
          name: t.name,
          href: settings.generateTopicIndexes ? `../../topics/${t.slug}.md` : null,
        })),
      ),
      '',
    );
  }
  if (p.patterns.length) {
    lines.push('**Patterns:**', '');
    lines.push(
      linkList(
        p.patterns.map((name) => ({
          name,
          href: settings.generatePatternIndexes ? `../../patterns/${slugify(name)}.md` : null,
        })),
      ),
      '',
    );
  }
  if (p.customTags.length) {
    lines.push(`**Tags:** ${p.customTags.map(escapeMd).join(', ')}`, '');
  }

  lines.push(p.solutions.length > 1 ? '## Solutions' : '## Solution', '');
  for (const s of sortedSolutions(p)) {
    const lang = getLanguage(s.language);
    lines.push(`### ${lang.displayName}`, '');
    const facts = [`[\`solutions/${lang.fileName}\`](solutions/${lang.fileName})`];
    if (s.runtime) facts.push(`Runtime: ${escapeMd(s.runtime)}`);
    if (s.memory) facts.push(`Memory: ${escapeMd(s.memory)}`);
    lines.push(facts.join(' · '), '');
    lines.push(codeBlock(s.code, lang.fence), '');
  }

  // Complexity is only shown when the user provided it; it is never inferred.
  if (p.timeComplexity || p.spaceComplexity) {
    lines.push('## Complexity', '');
    if (p.timeComplexity) lines.push(`- Time: ${escapeMd(p.timeComplexity)}`);
    if (p.spaceComplexity) lines.push(`- Space: ${escapeMd(p.spaceComplexity)}`);
    lines.push('');
  }

  if (p.notes?.trim()) {
    lines.push('## Notes', '', p.notes.trim(), '');
  }

  if (p.savedAttempts.length) {
    lines.push('## Saved Attempts', '');
    const kindLabel = {
      new_approach: 'New approach',
      important_revision: 'Important revision',
      manual: 'Saved',
    };
    for (const a of [...p.savedAttempts].sort((x, y) => x.path.localeCompare(y.path))) {
      const note = a.note ? ` — ${escapeMd(a.note)}` : '';
      lines.push(
        `- [${a.path.replace(/^attempts\//, '')}](${a.path}) · ${kindLabel[a.kind]}${note}`,
      );
    }
    lines.push('');
  }

  lines.push('## Progress', '');
  lines.push(`- Status: ${REVISION_STATUS_LABELS[p.status]}`);
  if (p.firstSolvedAt) lines.push(`- First solved: ${isoDate(p.firstSolvedAt)}`);
  if (p.lastSolvedAt) lines.push(`- Last solved: ${isoDate(p.lastSolvedAt)}`);
  lines.push(`- Revisions: ${p.counts.revisions}`);
  lines.push('');

  return lines.join('\n');
}

export function problemMetadata(p: ProblemRecord): Record<string, unknown> {
  const numericId = /^\d+$/.test(p.frontendId) ? Number(p.frontendId) : p.frontendId;
  const solutions = sortedSolutions(p);
  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    id: numericId,
    questionId: p.questionId,
    title: p.title,
    slug: p.titleSlug,
    difficulty: p.difficulty,
    leetcodeUrl: leetcodeProblemUrl(p.titleSlug),
    topics: p.topics.map((t) => t.name),
    patterns: p.patterns,
    customTags: p.customTags,
    languages: solutions.map((s) => getLanguage(s.language).displayName),
    solutions: solutions.map((s) => ({
      language: getLanguage(s.language).displayName,
      languageKey: s.language,
      file: `solutions/${getLanguage(s.language).fileName}`,
      runtime: s.runtime,
      memory: s.memory,
      updatedAt: s.updatedAt.toISOString(),
    })),
    status: p.status,
    attemptCount: p.counts.attempts,
    acceptedCount: p.counts.accepted,
    wrongAnswerCount: p.counts.wrongAnswer,
    timeLimitExceededCount: p.counts.timeLimitExceeded,
    memoryLimitExceededCount: p.counts.memoryLimitExceeded,
    runtimeErrorCount: p.counts.runtimeError,
    compileErrorCount: p.counts.compileError,
    revisionCount: p.counts.revisions,
    firstSolvedAt: p.firstSolvedAt?.toISOString() ?? null,
    lastSolvedAt: p.lastSolvedAt?.toISOString() ?? null,
    lastRevisedAt: p.lastRevisedAt?.toISOString() ?? null,
    ...(p.timeComplexity || p.spaceComplexity
      ? { complexity: { time: p.timeComplexity, space: p.spaceComplexity } }
      : {}),
  };
}

export function problemMetadataJson(p: ProblemRecord): string {
  return JSON.stringify(problemMetadata(p), null, 2) + '\n';
}
