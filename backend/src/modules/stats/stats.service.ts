import type { Kysely } from 'kysely';
import { getLanguage, groupIntoCategories, slugify } from '@lcsync/shared';
import type { CategoryCountDto, CategoryKey, ProblemSummaryDto, StatsDto } from '@lcsync/shared';
import type { Database } from '../../database/schema.js';
import type { ProblemService } from '../problems/problem.service.js';
import { isDirtyFor, loadProblems } from '../problems/problem-store.js';
import type { RepositoryService } from '../repository/repository.service.js';
import type { SyncJobStore } from '../sync/sync-jobs.js';

export type CategoryKind = 'topics' | 'patterns' | 'languages' | 'tags';

const KEYS: Record<CategoryKind, (p: ProblemSummaryDto) => CategoryKey[]> = {
  topics: (p) => p.topics,
  patterns: (p) => p.patterns.map((name) => ({ name, slug: slugify(name) })),
  languages: (p) => p.languages.map((l) => ({ name: getLanguage(l).displayName, slug: l })),
  tags: (p) => p.customTags.map((name) => ({ name, slug: slugify(name) })),
};

export function countCategories(
  problems: ProblemSummaryDto[],
  kind: CategoryKind,
): CategoryCountDto[] {
  return groupIntoCategories(problems, KEYS[kind]).map((c) => ({
    name: c.name,
    slug: c.slug,
    count: c.items.length,
    easy: c.easy,
    medium: c.medium,
    hard: c.hard,
  }));
}

export class StatsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly problems: ProblemService,
    private readonly repositories: RepositoryService,
    private readonly jobs: SyncJobStore,
  ) {}

  async categories(userId: string, kind: CategoryKind): Promise<CategoryCountDto[]> {
    return countCategories(await this.problems.list(userId), kind);
  }

  async stats(userId: string): Promise<StatsDto> {
    const problems = await this.problems.list(userId);
    const repo = await this.repositories.getActive(userId);
    const pendingCommitCount = repo
      ? (await loadProblems(this.db, userId)).filter((p) => isDirtyFor(p, repo.id)).length
      : 0;
    return {
      total: problems.length,
      easy: problems.filter((p) => p.difficulty === 'Easy').length,
      medium: problems.filter((p) => p.difficulty === 'Medium').length,
      hard: problems.filter((p) => p.difficulty === 'Hard').length,
      topics: countCategories(problems, 'topics'),
      patterns: countCategories(problems, 'patterns'),
      languages: countCategories(problems, 'languages'),
      customTags: countCategories(problems, 'tags'),
      dueCount: problems.filter((p) => p.isDue).length,
      pendingCommitCount,
      recentSyncs: await this.jobs.listRecent(userId, 10),
    };
  }
}
