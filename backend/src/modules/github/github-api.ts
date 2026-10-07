/**
 * The subset of the GitHub REST API this application uses. The interface lets the sync logic be
 * tested against an in-memory fake (test/helpers/fake-github.ts).
 */
import type { BranchDto } from '@lcsync/shared';

export interface GitHubUser {
  id: number;
  login: string;
  avatarUrl: string | null;
}

export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  canPush: boolean;
}

export type BranchHead =
  | { state: 'ok'; commitSha: string }
  | { state: 'missing' }
  /** Repository has no commits at all. */
  | { state: 'empty' };

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

export type TreeChange =
  | { path: string; content: string }
  /** Delete the file at `path`. */
  | { path: string; delete: true };

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface GitHubApi {
  getAuthenticatedUser(): Promise<GitHubUser>;
  listRepositories(): Promise<GitHubRepository[]>;
  getRepositoryById(id: number): Promise<GitHubRepository>;
  createRepository(input: {
    name: string;
    private: boolean;
    description?: string;
  }): Promise<GitHubRepository>;
  listBranches(ref: RepoRef): Promise<BranchDto[]>;
  getBranchHead(ref: RepoRef, branch: string): Promise<BranchHead>;
  getCommitTreeSha(ref: RepoRef, commitSha: string): Promise<string>;
  /** Direct children of a tree (non-recursive). */
  listTree(ref: RepoRef, treeSha: string): Promise<TreeEntry[]>;
  /** UTF-8 content of a file at a commit, or null if it does not exist. */
  getFileContent(ref: RepoRef, path: string, commitSha: string): Promise<string | null>;
  createTree(ref: RepoRef, baseTreeSha: string, changes: TreeChange[]): Promise<string>;
  createCommit(
    ref: RepoRef,
    message: string,
    treeSha: string,
    parentShas: string[],
  ): Promise<string>;
  /** Fast-forward only. Returns false if the branch moved (someone else pushed). */
  updateBranch(ref: RepoRef, branch: string, commitSha: string): Promise<boolean>;
  /** Contents API single-file write; the only way to create the first commit of an empty repo. */
  createFile(ref: RepoRef, path: string, content: string, message: string): Promise<void>;
}
