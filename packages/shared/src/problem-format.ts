/**
 * Naming rules for problem directories and repository paths. These are part of the public
 * repository format: changing them would move files, so they are covered by tests.
 */

/** Lowercase, ASCII, hyphen-separated slug. "3Sum" → "3sum", "C++ Tips!" → "c-tips". */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+\+/g, 'pp')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Zero-pads numeric LeetCode IDs to four digits (1 → "0001", 1234 → "1234", 10001 → "10001").
 * Non-numeric frontend IDs (e.g. "LCP 01", "面试题 01.01") are slugified instead.
 */
export function formatProblemId(frontendId: string | number): string {
  const raw = String(frontendId).trim();
  if (/^\d+$/.test(raw)) return raw.padStart(4, '0');
  return slugify(raw) || 'unknown';
}

/** Canonical directory name: "0001-two-sum". */
export function problemDirectoryName(frontendId: string | number, titleSlug: string): string {
  const id = formatProblemId(frontendId);
  const slug = slugify(titleSlug) || 'problem';
  return `${id}-${slug}`;
}

/**
 * Normalises a user-supplied repository root ("/", "", "./dsa/", "dsa\\leetcode") to a clean
 * relative prefix without leading/trailing slashes. Rejects path traversal.
 */
export function normalizeRootDir(input: string | null | undefined): string {
  const parts = (input ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) {
    throw new Error('Root directory must not contain ".."');
  }
  if (parts.some((p) => !/^[A-Za-z0-9._-]+$/.test(p))) {
    throw new Error('Root directory may only contain letters, digits, ".", "_" and "-"');
  }
  return parts.join('/');
}

/** Joins a root prefix with a repository-relative path. */
export function joinRepoPath(rootDir: string, relativePath: string): string {
  return rootDir ? `${rootDir}/${relativePath}` : relativePath;
}

export function leetcodeProblemUrl(titleSlug: string): string {
  return `https://leetcode.com/problems/${titleSlug}/`;
}

export function githubBlobUrl(owner: string, repo: string, branch: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${encoded}`;
}

export function githubTreeUrl(owner: string, repo: string, branch: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}/${encoded}`;
}
