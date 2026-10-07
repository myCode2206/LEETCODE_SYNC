import { describe, expect, it } from 'vitest';
import { DEFAULT_REPOSITORY_SETTINGS } from '@lcsync/shared';
import {
  buildCommitMessage,
  fullSyncMessage,
  saveAttemptMessage,
} from '../src/modules/generator/commit-message.js';
import { codeBlock } from '../src/modules/generator/markdown.js';
import { problemMetadata, problemReadme } from '../src/modules/generator/problem-files.js';
import { generateRepository } from '../src/modules/generator/repository-generator.js';
import { mergeRootReadme, README_END, README_START } from '../src/modules/generator/root-readme.js';
import type { ProblemRecord } from '../src/modules/generator/types.js';

function record(overrides: Partial<ProblemRecord> = {}): ProblemRecord {
  return {
    userProblemId: 'up-1',
    questionId: '1',
    frontendId: '1',
    title: 'Two Sum',
    titleSlug: 'two-sum',
    difficulty: 'Easy',
    directoryName: '0001-two-sum',
    topics: [
      { name: 'Array', slug: 'array' },
      { name: 'Hash Table', slug: 'hash-table' },
    ],
    patterns: ['Hashing'],
    customTags: [],
    status: 'solved',
    notes: null,
    timeComplexity: null,
    spaceComplexity: null,
    counts: {
      attempts: 1,
      accepted: 1,
      wrongAnswer: 0,
      timeLimitExceeded: 0,
      memoryLimitExceeded: 0,
      runtimeError: 0,
      compileError: 0,
      revisions: 1,
    },
    firstSolvedAt: new Date('2026-09-01T10:00:00Z'),
    lastSolvedAt: new Date('2026-10-07T10:00:00Z'),
    lastRevisedAt: new Date('2026-10-07T10:00:00Z'),
    solutions: [
      {
        language: 'python3',
        code: 'class Solution:\n    pass\n',
        runtime: '0 ms',
        memory: '17 MB',
        updatedAt: new Date('2026-10-07T10:00:00Z'),
      },
    ],
    savedAttempts: [],
    ...overrides,
  };
}

const opts = { settings: DEFAULT_REPOSITORY_SETTINGS, rootDir: '' };

describe('problem README', () => {
  it('contains only reliable information', () => {
    const md = problemReadme(record(), opts);
    expect(md).toContain('# 1. Two Sum');
    expect(md).toContain('**LeetCode:** [#1](https://leetcode.com/problems/two-sum/)');
    expect(md).toContain('**Difficulty:** Easy');
    expect(md).toContain('- [Array](../../topics/array.md)');
    expect(md).toContain('- [Hashing](../../patterns/hashing.md)');
    expect(md).toContain('```python\nclass Solution:\n    pass\n```');
    expect(md).not.toContain('## Complexity'); // never invented
  });

  it('shows user-provided complexity and notes', () => {
    const md = problemReadme(
      record({ timeComplexity: 'O(n)', spaceComplexity: 'O(n)', notes: 'Use a map.' }),
      opts,
    );
    expect(md).toContain('## Complexity\n\n- Time: O(n)\n- Space: O(n)');
    expect(md).toContain('## Notes\n\nUse a map.');
  });

  it('uses plain text instead of links when indexes are disabled', () => {
    const md = problemReadme(record(), {
      ...opts,
      settings: { ...DEFAULT_REPOSITORY_SETTINGS, generateTopicIndexes: false },
    });
    expect(md).toContain('- Array\n');
  });

  it('uses a longer fence when code contains backticks', () => {
    expect(codeBlock('s = "```"', 'python')).toBe('````python\ns = "```"\n````');
  });
});

describe('metadata.json', () => {
  it('matches the documented schema', () => {
    expect(problemMetadata(record({ customTags: ['Google'] }))).toMatchObject({
      schemaVersion: 1,
      id: 1,
      title: 'Two Sum',
      slug: 'two-sum',
      difficulty: 'Easy',
      leetcodeUrl: 'https://leetcode.com/problems/two-sum/',
      topics: ['Array', 'Hash Table'],
      patterns: ['Hashing'],
      customTags: ['Google'],
      languages: ['Python'],
      attemptCount: 1,
      acceptedCount: 1,
      revisionCount: 1,
      firstSolvedAt: '2026-09-01T10:00:00.000Z',
      lastSolvedAt: '2026-10-07T10:00:00.000Z',
    });
  });
});

describe('repository generation', () => {
  const twoSum = record();
  const wordSearch = record({
    userProblemId: 'up-79',
    questionId: '79',
    frontendId: '79',
    title: 'Word Search',
    titleSlug: 'word-search',
    difficulty: 'Medium',
    directoryName: '0079-word-search',
    topics: [
      { name: 'Array', slug: 'array' },
      { name: 'Backtracking', slug: 'backtracking' },
      { name: 'Matrix', slug: 'matrix' },
    ],
    patterns: ['Backtracking'],
  });

  it('writes a multi-topic problem once and references it from every topic', () => {
    const out = generateRepository([twoSum, wordSearch], 'all', opts);
    const byPath = new Map(out.writes.map((w) => [w.path, w.content]));
    expect([...byPath.keys()].filter((p) => p.includes('0079-word-search/solutions'))).toEqual([
      'problems/0079-word-search/solutions/python.py',
    ]);
    const array = byPath.get('topics/array.md')!;
    expect(array).toContain('Total Problems: 2');
    expect(array).toContain('## Easy (1)\n\n- [1. Two Sum](../problems/0001-two-sum/)');
    expect(array).toContain('## Medium (1)\n\n- [79. Word Search](../problems/0079-word-search/)');
    expect(byPath.get('topics/matrix.md')).toContain('../problems/0079-word-search/');
    expect(byPath.get('topics/README.md')).toContain('| [Array](array.md) | 2 | 1 | 1 | 0 |');
  });

  it('only writes problem directories in scope but always regenerates indexes', () => {
    const out = generateRepository([twoSum, wordSearch], new Set(['up-79']), opts);
    const paths = out.writes.map((w) => w.path);
    expect(paths.some((p) => p.startsWith('problems/0001-two-sum'))).toBe(false);
    expect(paths).toContain('problems/0079-word-search/README.md');
    expect(paths).toContain('topics/hash-table.md');
  });

  it('prefixes everything with the root directory', () => {
    const out = generateRepository([twoSum], 'all', { ...opts, rootDir: 'dsa/leetcode' });
    expect(out.writes.every((w) => w.path.startsWith('dsa/leetcode/'))).toBe(true);
    expect(out.merges[0]!.path).toBe('dsa/leetcode/README.md');
    expect(out.ownedDirs).toContain('dsa/leetcode/topics');
  });

  it('skips disabled sections', () => {
    const out = generateRepository([twoSum], 'all', {
      ...opts,
      settings: {
        ...DEFAULT_REPOSITORY_SETTINGS,
        generatePatternIndexes: false,
        generateStats: false,
        generateReadme: false,
      },
    });
    expect(out.writes.some((w) => w.path.startsWith('patterns/'))).toBe(false);
    expect(out.writes.some((w) => w.path.startsWith('stats/'))).toBe(false);
    expect(out.merges).toEqual([]);
    expect(out.ownedDirs).not.toContain('patterns');
  });

  it('is deterministic', () => {
    const a = generateRepository([wordSearch, twoSum], 'all', opts);
    const b = generateRepository([twoSum, wordSearch], 'all', opts);
    const norm = (o: typeof a) => o.writes.map((w) => `${w.path}\n${w.content}`).sort();
    expect(norm(a)).toEqual(norm(b));
  });
});

describe('root README merge', () => {
  const block = `${README_START}\nstats\n${README_END}`;

  it('creates a README when none exists', () => {
    expect(mergeRootReadme(null, block)).toBe(`# LeetCode Solutions\n\n${block}\n`);
  });

  it('keeps user content and only replaces the managed block', () => {
    const existing = `# My DSA\n\nPersonal intro.\n\n${README_START}\nold\n${README_END}\n\n## Footer\n`;
    const merged = mergeRootReadme(existing, block);
    expect(merged).toBe(`# My DSA\n\nPersonal intro.\n\n${block}\n\n## Footer\n`);
  });

  it('appends to a README without markers and is idempotent', () => {
    const once = mergeRootReadme('# Notes\n\nHello', block);
    expect(once).toBe(`# Notes\n\nHello\n\n${block}\n`);
    expect(mergeRootReadme(once, block)).toBe(once);
  });
});

describe('commit messages', () => {
  const base = { frontendId: '1', title: 'Two Sum', slug: 'two-sum', difficulty: 'Easy' };
  it.each([
    ['new_problem', 'python3', 'leetcode: add #1 Two Sum'],
    ['new_language', 'cpp', 'leetcode: add #1 Two Sum (C++)'],
    ['improved', 'python3', 'leetcode: improve #1 Two Sum'],
    ['metadata', null, 'leetcode: update #1 Two Sum'],
  ] as const)('%s → %s', (changeKind, language, expected) => {
    expect(buildCommitMessage({ ...base, changeKind, language })).toBe(expected);
  });

  it('supports custom templates and extra problems', () => {
    expect(
      buildCommitMessage(
        { ...base, changeKind: 'new_problem', language: 'java' },
        'feat({difficulty}): {title} [{language}]',
      ),
    ).toBe('feat(Easy): Two Sum [Java]');
    expect(buildCommitMessage({ ...base, changeKind: 'improved', additionalProblems: 2 })).toBe(
      'leetcode: improve #1 Two Sum (+2 more)',
    );
  });

  it('formats bulk and attempt messages', () => {
    expect(fullSyncMessage(1)).toBe('leetcode: sync 1 problem');
    expect(fullSyncMessage(347)).toBe('leetcode: sync 347 problems');
    expect(saveAttemptMessage('1', 'Two Sum', 'python3')).toBe(
      'leetcode: save attempt for #1 Two Sum (Python)',
    );
  });
});
