import { AppError } from '../../common/app-error.js';
import type { GitHubApi, RepoRef, TreeChange } from './github-api.js';

export interface FileWrite {
  path: string;
  content: string;
}

export interface FileMerge {
  path: string;
  /** Produces the new content from the file currently on the branch (null if absent). */
  merge: (existing: string | null) => string;
}

export interface CommitRequest {
  ref: RepoRef;
  branch: string;
  message: string;
  writes: FileWrite[];
  merges?: FileMerge[];
  /**
   * Directories fully owned by the generator. Files directly inside them that are not part of
   * `writes` are deleted in the same commit (e.g. the index of a topic that no longer has
   * problems). Nothing outside these directories is ever deleted.
   */
  ownedDirs?: string[];
}

export interface CommitResult {
  /** New commit SHA, or null when the branch already contained exactly these files. */
  commitSha: string | null;
  headSha: string;
}

const MAX_ATTEMPTS = 3;
const OWNED_FILE = /\.(md|json)$/;

/**
 * Writes many files as ONE commit using the Git Data API:
 * head → base tree → new tree (base + changes) → commit → fast-forward ref.
 *
 * - Atomic: the branch only moves after everything is uploaded, so a failure part-way leaves
 *   the repository untouched.
 * - Idempotent: if the new tree equals the base tree nothing is committed.
 * - Concurrency-safe: the ref update is fast-forward only; if the branch moved, rebuild on
 *   the new head.
 */
export async function commitFiles(api: GitHubApi, req: CommitRequest): Promise<CommitResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const head = await resolveHead(api, req);
    const baseTree = await api.getCommitTreeSha(req.ref, head);

    const changes: TreeChange[] = req.writes.map((w) => ({ path: w.path, content: w.content }));
    for (const m of req.merges ?? []) {
      const existing = await api.getFileContent(req.ref, m.path, head);
      changes.push({ path: m.path, content: m.merge(existing) });
    }

    const written = new Set(changes.map((c) => c.path));
    for (const dir of req.ownedDirs ?? []) {
      for (const path of await listFiles(api, req.ref, baseTree, dir)) {
        if (!written.has(path) && OWNED_FILE.test(path)) changes.push({ path, delete: true });
      }
    }

    if (changes.length === 0) return { commitSha: null, headSha: head };
    const newTree = await api.createTree(req.ref, baseTree, changes);
    if (newTree === baseTree) return { commitSha: null, headSha: head };

    const commitSha = await api.createCommit(req.ref, req.message, newTree, [head]);
    if (await api.updateBranch(req.ref, req.branch, commitSha)) {
      return { commitSha, headSha: commitSha };
    }
    // Branch moved under us: loop and rebuild on top of the new head.
  }
  throw new AppError(
    'GITHUB_CONFLICT',
    'The branch kept changing while syncing (another push in progress). Sync will be retried.',
  );
}

async function resolveHead(api: GitHubApi, req: CommitRequest): Promise<string> {
  const head = await api.getBranchHead(req.ref, req.branch);
  if (head.state === 'ok') return head.commitSha;
  if (head.state === 'missing') {
    throw new AppError(
      'GITHUB_BRANCH_NOT_FOUND',
      `Branch "${req.branch}" does not exist in ${req.ref.owner}/${req.ref.repo}. Choose another branch in Settings.`,
    );
  }
  // Empty repository: the Git Data API needs at least one commit. Create it via the Contents API.
  const first = req.merges?.[0] ?? null;
  const bootstrapPath = first?.path ?? 'README.md';
  const bootstrapContent = first ? first.merge(null) : '# LeetCode Solutions\n';
  await api.createFile(req.ref, bootstrapPath, bootstrapContent, 'leetcode: initialize repository');
  const after = await api.getBranchHead(req.ref, req.branch);
  if (after.state !== 'ok') {
    throw new AppError(
      'GITHUB_BRANCH_NOT_FOUND',
      `Could not initialise branch "${req.branch}" in the empty repository. Use the repository's default branch.`,
    );
  }
  return after.commitSha;
}

/** Paths of blobs directly inside `dir` (repo-relative), or [] if the directory does not exist. */
async function listFiles(
  api: GitHubApi,
  ref: RepoRef,
  rootTree: string,
  dir: string,
): Promise<string[]> {
  let treeSha = rootTree;
  for (const segment of dir.split('/').filter(Boolean)) {
    const entry = (await api.listTree(ref, treeSha)).find(
      (e) => e.path === segment && e.type === 'tree',
    );
    if (!entry) return [];
    treeSha = entry.sha;
  }
  return (await api.listTree(ref, treeSha))
    .filter((e) => e.type === 'blob')
    .map((e) => `${dir}/${e.path}`);
}
