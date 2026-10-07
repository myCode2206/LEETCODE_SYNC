import { DIFFICULTIES, getLanguage, groupIntoCategories, slugify } from '@lcsync/shared';
import type { Category, CategoryKey, Difficulty } from '@lcsync/shared';
import { compareProblems, escapeMd, problemLabel, table } from './markdown.js';
import type { ProblemRecord } from './types.js';

export type IndexKind = 'topics' | 'patterns' | 'languages';

export const keysByKind: Record<IndexKind, (p: ProblemRecord) => CategoryKey[]> = {
  topics: (p) => p.topics,
  patterns: (p) => p.patterns.map((name) => ({ name, slug: slugify(name) })),
  languages: (p) =>
    p.solutions.map((s) => {
      const lang = getLanguage(s.language);
      return { name: lang.displayName, slug: lang.indexSlug };
    }),
};

const TITLES: Record<IndexKind, { heading: string; column: string }> = {
  topics: { heading: 'Topics', column: 'Topic' },
  patterns: { heading: 'Patterns', column: 'Pattern' },
  languages: { heading: 'Languages', column: 'Language' },
};

export function categoriesOf(
  kind: IndexKind,
  problems: ProblemRecord[],
): Category<ProblemRecord>[] {
  return groupIntoCategories(problems, keysByKind[kind]);
}

/** Link from an index file (one level below the root) into a problem directory. */
function problemHref(p: ProblemRecord): string {
  return `../problems/${p.directoryName}/`;
}

function entry(p: ProblemRecord, href: string): string {
  return `- [${problemLabel(p)}](${href})`;
}

/** Index grouped by difficulty, e.g. topics/array.md. */
function categoryPage(cat: Category<ProblemRecord>, hrefFor: (p: ProblemRecord) => string): string {
  const lines = [`# ${escapeMd(cat.name)}`, '', `Total Problems: ${cat.items.length}`, ''];
  for (const difficulty of DIFFICULTIES) {
    const group = cat.items.filter((p) => p.difficulty === difficulty).sort(compareProblems);
    if (!group.length) continue;
    lines.push(`## ${difficulty} (${group.length})`, '');
    lines.push(...group.map((p) => entry(p, hrefFor(p))), '');
  }
  return lines.join('\n');
}

function directoryReadme(kind: IndexKind, cats: Category<ProblemRecord>[]): string {
  const { heading, column } = TITLES[kind];
  const rows = cats.map((c) => [
    `[${escapeMd(c.name)}](${c.slug}.md)`,
    String(c.items.length),
    String(c.easy),
    String(c.medium),
    String(c.hard),
  ]);
  return [
    `# ${heading}`,
    '',
    rows.length
      ? table([column, 'Problems', 'Easy', 'Medium', 'Hard'], ['l', 'r', 'r', 'r', 'r'], rows)
      : `_No ${heading.toLowerCase()} yet._`,
    '',
  ].join('\n');
}

/** Files for one index directory (paths relative to the repository root dir). */
export function categoryIndexFiles(
  kind: IndexKind,
  problems: ProblemRecord[],
): { path: string; content: string }[] {
  const cats = categoriesOf(kind, problems);
  const files = cats.map((cat) => ({
    path: `${kind}/${cat.slug}.md`,
    content: categoryPage(cat, (p) => {
      if (kind !== 'languages') return problemHref(p);
      const solution = p.solutions.find((s) => getLanguage(s.language).indexSlug === cat.slug);
      return solution
        ? `${problemHref(p)}solutions/${getLanguage(solution.language).fileName}`
        : problemHref(p);
    }),
  }));
  files.push({ path: `${kind}/README.md`, content: directoryReadme(kind, cats) });
  return files;
}

export function difficultyIndexFiles(
  problems: ProblemRecord[],
): { path: string; content: string }[] {
  return DIFFICULTIES.map((difficulty: Difficulty) => {
    const group = problems.filter((p) => p.difficulty === difficulty).sort(compareProblems);
    const lines = [`# ${difficulty}`, '', `Total Problems: ${group.length}`, ''];
    for (const p of group) {
      const topics = p.topics.length
        ? ` · ${p.topics.map((t) => escapeMd(t.name)).join(', ')}`
        : '';
      lines.push(`${entry(p, problemHref(p))}${topics}`);
    }
    if (group.length) lines.push('');
    return { path: `difficulty/${difficulty.toLowerCase()}.md`, content: lines.join('\n') };
  });
}
