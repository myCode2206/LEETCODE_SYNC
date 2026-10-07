import { describe, expect, it } from 'vitest';
import {
  formatProblemId,
  githubBlobUrl,
  joinRepoPath,
  normalizeRootDir,
  problemDirectoryName,
  slugify,
} from '../src/index.js';

describe('formatProblemId', () => {
  it.each([
    [1, '0001'],
    [15, '0015'],
    [206, '0206'],
    [1234, '1234'],
    [10001, '10001'],
    ['42', '0042'],
    [' 7 ', '0007'],
  ])('pads %s to %s', (input, expected) => {
    expect(formatProblemId(input)).toBe(expected);
  });

  it('slugifies non-numeric frontend ids (contest / regional problems)', () => {
    expect(formatProblemId('LCP 01')).toBe('lcp-01');
    expect(formatProblemId('剑指 Offer 03')).toBe('offer-03');
  });
});

describe('slugify', () => {
  it.each([
    ['Two Sum', 'two-sum'],
    ['3Sum', '3sum'],
    ['Reverse Linked List', 'reverse-linked-list'],
    ['  Hash   Table ', 'hash-table'],
    ['Fast & Slow Pointers', 'fast-slow-pointers'],
    ["Kadane's Algorithm", 'kadane-s-algorithm'],
    ['C++', 'cpp'],
    ['C#', 'csharp'],
    ['Heap / Top K', 'heap-top-k'],
    ['Café', 'cafe'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('problemDirectoryName', () => {
  it.each([
    ['1', 'two-sum', '0001-two-sum'],
    ['15', '3sum', '0015-3sum'],
    ['206', 'reverse-linked-list', '0206-reverse-linked-list'],
    ['79', 'word-search', '0079-word-search'],
  ])('(%s, %s) → %s', (id, slug, expected) => {
    expect(problemDirectoryName(id, slug)).toBe(expected);
  });
});

describe('normalizeRootDir', () => {
  it.each([
    ['', ''],
    ['/', ''],
    ['./', ''],
    ['/dsa/', 'dsa'],
    ['dsa\\leetcode', 'dsa/leetcode'],
    ['a//b', 'a/b'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeRootDir(input)).toBe(expected);
  });

  it('rejects traversal and odd characters', () => {
    expect(() => normalizeRootDir('../etc')).toThrow();
    expect(() => normalizeRootDir('a/../../b')).toThrow();
    expect(() => normalizeRootDir('my dir')).toThrow();
  });
});

describe('paths and urls', () => {
  it('joins root prefixes', () => {
    expect(joinRepoPath('', 'problems/0001-two-sum/README.md')).toBe(
      'problems/0001-two-sum/README.md',
    );
    expect(joinRepoPath('dsa', 'README.md')).toBe('dsa/README.md');
  });

  it('builds encoded blob urls', () => {
    expect(
      githubBlobUrl(
        'rajat',
        'leetcode-solutions',
        'main',
        'problems/0001-two-sum/solutions/cpp.cpp',
      ),
    ).toBe(
      'https://github.com/rajat/leetcode-solutions/blob/main/problems/0001-two-sum/solutions/cpp.cpp',
    );
    expect(githubBlobUrl('o', 'r', 'feature/x', 'a b.md')).toBe(
      'https://github.com/o/r/blob/feature%2Fx/a%20b.md',
    );
  });
});
