import type { Difficulty } from './status.js';

export interface CategoryKey {
  name: string;
  slug: string;
}

export interface Category<T> extends CategoryKey {
  items: T[];
  easy: number;
  medium: number;
  hard: number;
}

/**
 * Groups items into (possibly overlapping) categories. One item may appear in several
 * categories — e.g. a problem in both "Array" and "Hash Table" — without being copied.
 * Sorted by size (desc), then name.
 */
export function groupIntoCategories<T extends { difficulty: Difficulty }>(
  items: readonly T[],
  keysOf: (item: T) => readonly CategoryKey[],
): Category<T>[] {
  const bySlug = new Map<string, Category<T>>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const key of keysOf(item)) {
      if (seen.has(key.slug)) continue;
      seen.add(key.slug);
      let cat = bySlug.get(key.slug);
      if (!cat) {
        cat = { name: key.name, slug: key.slug, items: [], easy: 0, medium: 0, hard: 0 };
        bySlug.set(key.slug, cat);
      }
      cat.items.push(item);
      if (item.difficulty === 'Easy') cat.easy++;
      else if (item.difficulty === 'Medium') cat.medium++;
      else cat.hard++;
    }
  }
  return [...bySlug.values()].sort(
    (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name),
  );
}
