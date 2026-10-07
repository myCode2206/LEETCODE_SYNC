import {
  computeDueAt,
  getLanguage,
  githubBlobUrl,
  githubTreeUrl,
  joinRepoPath,
  leetcodeProblemUrl,
} from '@lcsync/shared';
import type { ProblemSummaryDto, SolutionDto } from '@lcsync/shared';
import type { ActiveRepository } from '../repository/repository.service.js';
import type { StoredProblem } from './problem-store.js';

function lastActivity(p: StoredProblem): Date | null {
  const dates = [p.lastSolvedAt, p.lastRevisedAt].filter((d): d is Date => d !== null);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

function problemPath(p: StoredProblem, repo: ActiveRepository): string {
  return joinRepoPath(repo.rootDir, `problems/${p.directoryName}`);
}

export function toSummaryDto(
  p: StoredProblem,
  repo: ActiveRepository | null,
  now: Date,
): ProblemSummaryDto {
  const dueAt = computeDueAt(p.status, lastActivity(p));
  const onGitHub = repo && p.solutions.some((s) => s.syncedRepositoryId === repo.id);
  return {
    slug: p.titleSlug,
    frontendId: p.frontendId,
    title: p.title,
    difficulty: p.difficulty,
    topics: p.topics,
    patterns: p.patterns,
    customTags: p.customTags,
    languages: p.solutions.map((s) => s.language).sort(),
    status: p.status,
    attemptCount: p.counts.attempts,
    acceptedCount: p.counts.accepted,
    revisionCount: p.counts.revisions,
    firstSolvedAt: p.firstSolvedAt?.toISOString() ?? null,
    lastSolvedAt: p.lastSolvedAt?.toISOString() ?? null,
    lastRevisedAt: p.lastRevisedAt?.toISOString() ?? null,
    dueAt: dueAt?.toISOString() ?? null,
    isDue: dueAt !== null && dueAt <= now,
    leetcodeUrl: leetcodeProblemUrl(p.titleSlug),
    githubUrl: onGitHub
      ? githubTreeUrl(repo.owner, repo.name, repo.branch, problemPath(p, repo))
      : null,
  };
}

export function toSolutionDtos(p: StoredProblem, repo: ActiveRepository | null): SolutionDto[] {
  return p.solutions.map((s) => {
    const lang = getLanguage(s.language);
    const synced = !!repo && s.syncedRepositoryId === repo.id && s.syncedCodeHash === s.codeHash;
    const onGitHub = !!repo && s.syncedRepositoryId === repo.id;
    return {
      language: s.language,
      displayName: lang.displayName,
      runtime: s.runtime,
      memory: s.memory,
      updatedAt: s.updatedAt.toISOString(),
      githubUrl: onGitHub
        ? githubBlobUrl(
            repo.owner,
            repo.name,
            repo.branch,
            `${problemPath(p, repo)}/solutions/${lang.fileName}`,
          )
        : null,
      synced,
    };
  });
}
