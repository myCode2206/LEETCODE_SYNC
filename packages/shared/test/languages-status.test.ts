import { describe, expect, it } from 'vitest';
import {
  computeDueAt,
  getLanguage,
  isDue,
  mapLeetCodeStatus,
  normalizeLabels,
  normalizeLanguageKey,
  patternsFromTopics,
  startsNewRevisionSession,
} from '../src/index.js';

describe('languages', () => {
  it('maps LeetCode slugs to solution file names', () => {
    expect(getLanguage('python3').fileName).toBe('python.py');
    expect(getLanguage('cpp').fileName).toBe('cpp.cpp');
    expect(getLanguage('java').fileName).toBe('java.java');
    expect(getLanguage('javascript').fileName).toBe('javascript.js');
    expect(getLanguage('golang').fileName).toBe('go.go');
  });

  it('keeps Python 2 and Python 3 as distinct solutions', () => {
    expect(getLanguage('python').fileName).not.toBe(getLanguage('python3').fileName);
  });

  it('normalises verbose names and aliases', () => {
    expect(normalizeLanguageKey('Python3')).toBe('python3');
    expect(normalizeLanguageKey('C++')).toBe('cpp');
    expect(normalizeLanguageKey('Go')).toBe('golang');
  });

  it('falls back safely for unknown languages', () => {
    const lang = getLanguage('Brainf*ck 2');
    expect(lang.fileName).toBe('brainfck2.txt');
    expect(lang.key).toBe('brainfck2');
  });
});

describe('mapLeetCodeStatus', () => {
  it.each([
    [10, 'accepted'],
    [11, 'wrong_answer'],
    [12, 'memory_limit_exceeded'],
    [14, 'time_limit_exceeded'],
    [15, 'runtime_error'],
    [20, 'compile_error'],
  ] as const)('code %i → %s', (code, status) => {
    expect(mapLeetCodeStatus(code)).toBe(status);
  });

  it('falls back to the status message', () => {
    expect(mapLeetCodeStatus(undefined, 'Time Limit Exceeded')).toBe('time_limit_exceeded');
    expect(mapLeetCodeStatus(999, 'Something new')).toBe('unknown');
  });
});

describe('revision policy', () => {
  const day = 24 * 3600 * 1000;
  const t0 = new Date('2026-09-01T10:00:00Z');

  it('computes due dates per status', () => {
    expect(computeDueAt('solved', t0)?.toISOString()).toBe('2026-09-08T10:00:00.000Z');
    expect(computeDueAt('need_revision', t0)?.toISOString()).toBe(t0.toISOString());
    expect(computeDueAt('new', null)).toBeNull();
  });

  it('reports due problems', () => {
    expect(isDue('revised', t0, new Date(t0.getTime() + 13 * day))).toBe(false);
    expect(isDue('revised', t0, new Date(t0.getTime() + 14 * day))).toBe(true);
    expect(isDue('mastered', t0, new Date(t0.getTime() + 30 * day))).toBe(false);
  });

  it('groups accepted submissions within 12h into one session', () => {
    expect(startsNewRevisionSession(null, t0)).toBe(true);
    expect(startsNewRevisionSession(t0, new Date(t0.getTime() + 3600 * 1000))).toBe(false);
    expect(startsNewRevisionSession(t0, new Date(t0.getTime() + 12 * 3600 * 1000))).toBe(true);
  });
});

describe('patterns and labels', () => {
  it('derives patterns only from topics that are patterns', () => {
    expect(patternsFromTopics(['array', 'hash-table'])).toEqual([]);
    expect(patternsFromTopics(['string', 'sliding-window', 'hash-table'])).toEqual([
      'Sliding Window',
    ]);
  });

  it('normalises user labels', () => {
    expect(normalizeLabels([' Google ', 'google', 'Must   Revise', ''])).toEqual([
      'Google',
      'Must Revise',
    ]);
  });
});
