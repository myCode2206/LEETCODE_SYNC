/**
 * Registry of LeetCode languages. The key is LeetCode's own language slug (as sent in the
 * `lang` field of a submission), which is also the stable identity of a solution:
 * one problem + one language key = one solution file.
 */
export interface LanguageInfo {
  /** LeetCode language slug, e.g. "python3". */
  key: string;
  /** Human readable name, e.g. "Python". */
  displayName: string;
  /** File name inside `solutions/`, e.g. "python.py". */
  fileName: string;
  /** Markdown code fence language. */
  fence: string;
  /** Slug for `languages/<slug>.md`. */
  indexSlug: string;
}

const LANGUAGES: readonly LanguageInfo[] = [
  {
    key: 'python3',
    displayName: 'Python',
    fileName: 'python.py',
    fence: 'python',
    indexSlug: 'python',
  },
  {
    key: 'python',
    displayName: 'Python 2',
    fileName: 'python2.py',
    fence: 'python',
    indexSlug: 'python2',
  },
  { key: 'cpp', displayName: 'C++', fileName: 'cpp.cpp', fence: 'cpp', indexSlug: 'cpp' },
  { key: 'java', displayName: 'Java', fileName: 'java.java', fence: 'java', indexSlug: 'java' },
  {
    key: 'javascript',
    displayName: 'JavaScript',
    fileName: 'javascript.js',
    fence: 'javascript',
    indexSlug: 'javascript',
  },
  {
    key: 'typescript',
    displayName: 'TypeScript',
    fileName: 'typescript.ts',
    fence: 'typescript',
    indexSlug: 'typescript',
  },
  { key: 'c', displayName: 'C', fileName: 'c.c', fence: 'c', indexSlug: 'c' },
  { key: 'csharp', displayName: 'C#', fileName: 'csharp.cs', fence: 'csharp', indexSlug: 'csharp' },
  { key: 'golang', displayName: 'Go', fileName: 'go.go', fence: 'go', indexSlug: 'go' },
  {
    key: 'kotlin',
    displayName: 'Kotlin',
    fileName: 'kotlin.kt',
    fence: 'kotlin',
    indexSlug: 'kotlin',
  },
  {
    key: 'swift',
    displayName: 'Swift',
    fileName: 'swift.swift',
    fence: 'swift',
    indexSlug: 'swift',
  },
  { key: 'rust', displayName: 'Rust', fileName: 'rust.rs', fence: 'rust', indexSlug: 'rust' },
  { key: 'ruby', displayName: 'Ruby', fileName: 'ruby.rb', fence: 'ruby', indexSlug: 'ruby' },
  {
    key: 'scala',
    displayName: 'Scala',
    fileName: 'scala.scala',
    fence: 'scala',
    indexSlug: 'scala',
  },
  { key: 'php', displayName: 'PHP', fileName: 'php.php', fence: 'php', indexSlug: 'php' },
  { key: 'dart', displayName: 'Dart', fileName: 'dart.dart', fence: 'dart', indexSlug: 'dart' },
  {
    key: 'racket',
    displayName: 'Racket',
    fileName: 'racket.rkt',
    fence: 'racket',
    indexSlug: 'racket',
  },
  {
    key: 'erlang',
    displayName: 'Erlang',
    fileName: 'erlang.erl',
    fence: 'erlang',
    indexSlug: 'erlang',
  },
  {
    key: 'elixir',
    displayName: 'Elixir',
    fileName: 'elixir.ex',
    fence: 'elixir',
    indexSlug: 'elixir',
  },
  { key: 'mysql', displayName: 'MySQL', fileName: 'mysql.sql', fence: 'sql', indexSlug: 'mysql' },
  {
    key: 'mssql',
    displayName: 'MS SQL Server',
    fileName: 'mssql.sql',
    fence: 'sql',
    indexSlug: 'mssql',
  },
  {
    key: 'oraclesql',
    displayName: 'Oracle',
    fileName: 'oracle.sql',
    fence: 'sql',
    indexSlug: 'oracle',
  },
  {
    key: 'postgresql',
    displayName: 'PostgreSQL',
    fileName: 'postgresql.sql',
    fence: 'sql',
    indexSlug: 'postgresql',
  },
  {
    key: 'pythondata',
    displayName: 'Pandas',
    fileName: 'pandas.py',
    fence: 'python',
    indexSlug: 'pandas',
  },
  { key: 'bash', displayName: 'Bash', fileName: 'bash.sh', fence: 'bash', indexSlug: 'bash' },
];

const BY_KEY = new Map(LANGUAGES.map((l) => [l.key, l]));

/** LeetCode sometimes reports verbose names ("Python3", "C++") instead of slugs. */
const ALIASES: Record<string, string> = {
  python3: 'python3',
  py3: 'python3',
  'c++': 'cpp',
  'c#': 'csharp',
  go: 'golang',
  js: 'javascript',
  ts: 'typescript',
  'ms sql server': 'mssql',
  oracle: 'oraclesql',
  pandas: 'pythondata',
};

/** Normalises any LeetCode language identifier to a registry key. */
export function normalizeLanguageKey(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (BY_KEY.has(lower)) return lower;
  const alias = ALIASES[lower];
  if (alias) return alias;
  // Unknown language: keep a safe slug so it still gets its own file.
  return lower.replace(/[^a-z0-9]+/g, '') || 'unknown';
}

/** Returns registry info, synthesising a safe fallback for languages LeetCode adds later. */
export function getLanguage(key: string): LanguageInfo {
  const known = BY_KEY.get(normalizeLanguageKey(key));
  if (known) return known;
  const safe = normalizeLanguageKey(key);
  return { key: safe, displayName: key, fileName: `${safe}.txt`, fence: '', indexSlug: safe };
}

export function listLanguages(): readonly LanguageInfo[] {
  return LANGUAGES;
}
