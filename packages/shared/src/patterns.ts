/**
 * DSA patterns are user-assigned. The only automatic source is LeetCode topics whose names
 * are themselves well-known patterns: this never guesses from the problem statement.
 */
export const SUGGESTED_PATTERNS = [
  'Sliding Window',
  'Two Pointers',
  'Binary Search',
  'Prefix Sum',
  "Kadane's Algorithm",
  'Backtracking',
  'Monotonic Stack',
  'Monotonic Queue',
  'Union Find',
  'Topological Sort',
  'Fast & Slow Pointers',
  'Divide and Conquer',
  'Dynamic Programming',
  'Greedy',
  'BFS',
  'DFS',
  'Heap / Top K',
  'Bit Manipulation',
  'Trie',
  'Hashing',
  'Intervals',
  'Shortest Path',
] as const;

/** LeetCode topic slug → pattern name (only topics that literally are patterns). */
const TOPIC_TO_PATTERN: Record<string, string> = {
  'sliding-window': 'Sliding Window',
  'two-pointers': 'Two Pointers',
  'binary-search': 'Binary Search',
  'prefix-sum': 'Prefix Sum',
  backtracking: 'Backtracking',
  'monotonic-stack': 'Monotonic Stack',
  'monotonic-queue': 'Monotonic Queue',
  'union-find': 'Union Find',
  'topological-sort': 'Topological Sort',
  'divide-and-conquer': 'Divide and Conquer',
  'dynamic-programming': 'Dynamic Programming',
  greedy: 'Greedy',
  'breadth-first-search': 'BFS',
  'depth-first-search': 'DFS',
  'heap-priority-queue': 'Heap / Top K',
  'bit-manipulation': 'Bit Manipulation',
  trie: 'Trie',
  'shortest-path': 'Shortest Path',
};

export function patternsFromTopics(topicSlugs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const slug of topicSlugs) {
    const pattern = TOPIC_TO_PATTERN[slug];
    if (pattern) out.add(pattern);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Trims, collapses whitespace and de-duplicates (case-insensitive) user-entered labels. */
export function normalizeLabels(labels: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of labels) {
    const label = raw.replace(/\s+/g, ' ').trim();
    if (!label || label.length > 60) continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, label);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
