import { joinRepoPath } from '@lcsync/shared';
import type { FileMerge, FileWrite } from '../github/git-committer.js';
import { categoryIndexFiles, difficultyIndexFiles } from './index-files.js';
import { problemFiles } from './problem-files.js';
import { mergeRootReadme, rootReadmeBlock } from './root-readme.js';
import { statsJson } from './stats-file.js';
import type { GeneratorOptions, ProblemRecord } from './types.js';

export interface RepositoryOutput {
  writes: FileWrite[];
  merges: FileMerge[];
  /** Index directories owned by the generator (stale files inside are pruned). */
  ownedDirs: string[];
}

/**
 * Projects database state onto repository files.
 *
 * @param problems every solved problem of the user (indexes always reflect all of them)
 * @param scope    user-problem ids whose directories should be (re)written; 'all' for a full sync
 */
export function generateRepository(
  problems: ProblemRecord[],
  scope: ReadonlySet<string> | 'all',
  opts: GeneratorOptions,
): RepositoryOutput {
  const { settings, rootDir } = opts;
  const at = (path: string) => joinRepoPath(rootDir, path);
  const writes: FileWrite[] = [];
  const ownedDirs: string[] = [];

  for (const p of problems) {
    if (scope !== 'all' && !scope.has(p.userProblemId)) continue;
    for (const f of problemFiles(p, opts)) {
      writes.push({ path: at(`problems/${p.directoryName}/${f.path}`), content: f.content });
    }
  }

  const indexes: [boolean, 'topics' | 'patterns' | 'languages'][] = [
    [settings.generateTopicIndexes, 'topics'],
    [settings.generatePatternIndexes, 'patterns'],
    [settings.generateLanguageIndexes, 'languages'],
  ];
  for (const [enabled, kind] of indexes) {
    if (!enabled) continue;
    ownedDirs.push(at(kind));
    for (const f of categoryIndexFiles(kind, problems))
      writes.push({ path: at(f.path), content: f.content });
  }
  if (settings.generateDifficultyIndexes) {
    ownedDirs.push(at('difficulty'));
    for (const f of difficultyIndexFiles(problems))
      writes.push({ path: at(f.path), content: f.content });
  }
  if (settings.generateStats) {
    ownedDirs.push(at('stats'));
    writes.push({ path: at('stats/stats.json'), content: statsJson(problems) });
  }

  const merges: FileMerge[] = [];
  if (settings.generateReadme) {
    const block = rootReadmeBlock(problems, opts);
    merges.push({ path: at('README.md'), merge: (existing) => mergeRootReadme(existing, block) });
  }

  return { writes, merges, ownedDirs };
}
