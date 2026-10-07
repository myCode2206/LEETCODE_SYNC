import { escapeMd, table } from './markdown.js';
import { categoriesOf } from './index-files.js';
import type { GeneratorOptions, ProblemRecord } from './types.js';

export const README_START = '<!-- leetcode-sync:start -->';
export const README_END = '<!-- leetcode-sync:end -->';

/** The generated section of the root README (between the markers). */
export function rootReadmeBlock(problems: ProblemRecord[], opts: GeneratorOptions): string {
  const { settings } = opts;
  const count = (d: string) => problems.filter((p) => p.difficulty === d).length;
  const lines: string[] = [
    README_START,
    '',
    'Automatically synchronized LeetCode solutions. Each problem has exactly one directory under',
    '[`problems/`](problems/); topic, pattern, difficulty and language pages link to it.',
    '',
    '## Progress',
    '',
    table(
      ['Difficulty', 'Solved'],
      ['l', 'r'],
      [
        [
          settings.generateDifficultyIndexes ? '[Easy](difficulty/easy.md)' : 'Easy',
          String(count('Easy')),
        ],
        [
          settings.generateDifficultyIndexes ? '[Medium](difficulty/medium.md)' : 'Medium',
          String(count('Medium')),
        ],
        [
          settings.generateDifficultyIndexes ? '[Hard](difficulty/hard.md)' : 'Hard',
          String(count('Hard')),
        ],
        ['**Total**', `**${problems.length}**`],
      ],
    ),
    '',
  ];

  const sections = [
    { kind: 'topics', title: 'Topics', column: 'Topic', linked: settings.generateTopicIndexes },
    {
      kind: 'patterns',
      title: 'Patterns',
      column: 'Pattern',
      linked: settings.generatePatternIndexes,
    },
    {
      kind: 'languages',
      title: 'Languages',
      column: 'Language',
      linked: settings.generateLanguageIndexes,
    },
  ] as const;
  for (const s of sections) {
    const cats = categoriesOf(s.kind, problems);
    if (!cats.length) continue;
    lines.push(`## ${s.title}`, '');
    lines.push(
      table(
        [s.column, 'Problems'],
        ['l', 'r'],
        cats.map((c) => [
          s.linked ? `[${escapeMd(c.name)}](${s.kind}/${c.slug}.md)` : escapeMd(c.name),
          String(c.items.length),
        ]),
      ),
      '',
    );
  }

  lines.push(README_END);
  return lines.join('\n');
}

/**
 * Inserts the generated block into the root README without touching the user's own text:
 * - no README → a new README with the block;
 * - README with markers → replace only what is between them;
 * - any other README (including GitHub's one-line auto-init) → keep it and append the block.
 */
export function mergeRootReadme(existing: string | null, block: string): string {
  const current = existing?.replace(/\s+$/, '') ?? '';
  if (!current.trim()) return `# LeetCode Solutions\n\n${block}\n`;
  const start = current.indexOf(README_START);
  const end = current.indexOf(README_END);
  if (start !== -1 && end > start) {
    return `${current.slice(0, start)}${block}${current.slice(end + README_END.length)}\n`;
  }
  return `${current}\n\n${block}\n`;
}
