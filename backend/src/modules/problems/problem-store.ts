import type { Kysely, Transaction } from 'kysely';
import { normalizeLabels, problemDirectoryName, slugify } from '@lcsync/shared';
import type { SaveAttemptKind } from '@lcsync/shared';
import type { Database } from '../../database/schema.js';
import type { ProblemRecord, SolutionRecord } from '../generator/types.js';

type Db = Kysely<Database> | Transaction<Database>;

export interface ProblemInfo {
  questionId: string;
  frontendId: string;
  title: string;
  titleSlug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topics: { name: string; slug: string }[];
  isPaidOnly?: boolean;
  content?: string | null;
}

export interface StoredSolution extends SolutionRecord {
  codeHash: string;
  syncedCodeHash: string | null;
  syncedRepositoryId: string | null;
}

export interface StoredProblem extends ProblemRecord {
  problemId: string;
  metadataDirty: boolean;
  solutions: StoredSolution[];
}

/** True if any part of this problem differs from what was last pushed to `repositoryId`. */
export function isDirtyFor(p: StoredProblem, repositoryId: string): boolean {
  return (
    p.solutions.length > 0 &&
    (p.metadataDirty ||
      p.solutions.some(
        (s) => s.syncedRepositoryId !== repositoryId || s.syncedCodeHash !== s.codeHash,
      ))
  );
}

/**
 * Upserts the global catalog entry (keyed by LeetCode's internal question id, so title or
 * slug changes update the row instead of creating a duplicate) and replaces its topics.
 */
export async function upsertCatalogProblem(trx: Db, info: ProblemInfo): Promise<string> {
  const existing = await trx
    .selectFrom('problems')
    .select(['id'])
    .where('question_id', '=', info.questionId)
    .executeTakeFirst();

  let problemId: string;
  if (existing) {
    problemId = existing.id;
    await trx
      .updateTable('problems')
      .set({
        frontend_id: info.frontendId,
        title: info.title,
        title_slug: info.titleSlug,
        difficulty: info.difficulty,
        is_paid_only: info.isPaidOnly ?? false,
        ...(info.content ? { content: info.content } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', problemId)
      .execute();
  } else {
    const row = await trx
      .insertInto('problems')
      .values({
        question_id: info.questionId,
        frontend_id: info.frontendId,
        title: info.title,
        title_slug: info.titleSlug,
        difficulty: info.difficulty,
        directory_name: problemDirectoryName(info.frontendId, info.titleSlug),
        is_paid_only: info.isPaidOnly ?? false,
        content: info.content ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    problemId = row.id;
  }

  // Problems without topics are valid: they simply appear in no topic index.
  const topics = dedupeBySlug(info.topics);
  await trx.deleteFrom('problem_topics').where('problem_id', '=', problemId).execute();
  for (const topic of topics) {
    const topicRow = await trx
      .insertInto('topics')
      .values({ slug: topic.slug, name: topic.name })
      .onConflict((oc) => oc.column('slug').doUpdateSet({ name: topic.name }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('problem_topics')
      .values({ problem_id: problemId, topic_id: topicRow.id })
      .execute();
  }
  return problemId;
}

function dedupeBySlug(topics: { name: string; slug: string }[]): { name: string; slug: string }[] {
  const map = new Map<string, { name: string; slug: string }>();
  for (const t of topics) {
    const slug = slugify(t.slug);
    if (slug && !map.has(slug)) map.set(slug, { name: t.name.trim(), slug });
  }
  return [...map.values()];
}

export async function getOrCreateUserProblem(trx: Db, userId: string, problemId: string) {
  await trx
    .insertInto('user_problems')
    .values({ user_id: userId, problem_id: problemId, status: 'new' })
    .onConflict((oc) => oc.columns(['user_id', 'problem_id']).doNothing())
    .execute();
  return trx
    .selectFrom('user_problems')
    .selectAll()
    .where('user_id', '=', userId)
    .where('problem_id', '=', problemId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

export async function setPatterns(trx: Db, userProblemId: string, names: string[]): Promise<void> {
  await trx
    .deleteFrom('user_problem_patterns')
    .where('user_problem_id', '=', userProblemId)
    .execute();
  for (const name of normalizeLabels(names)) {
    const slug = slugify(name);
    if (!slug) continue;
    const row = await trx
      .insertInto('patterns')
      .values({ slug, name })
      .onConflict((oc) => oc.column('slug').doUpdateSet({ slug }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('user_problem_patterns')
      .values({ user_problem_id: userProblemId, pattern_id: row.id })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}

export async function setCustomTags(
  trx: Db,
  userId: string,
  userProblemId: string,
  names: string[],
): Promise<void> {
  await trx.deleteFrom('user_problem_tags').where('user_problem_id', '=', userProblemId).execute();
  for (const name of normalizeLabels(names)) {
    const slug = slugify(name);
    if (!slug) continue;
    const row = await trx
      .insertInto('custom_tags')
      .values({ user_id: userId, slug, name })
      .onConflict((oc) => oc.columns(['user_id', 'slug']).doUpdateSet({ slug }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('user_problem_tags')
      .values({ user_problem_id: userProblemId, tag_id: row.id })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}

export interface LoadOptions {
  /** Include solution and attempt code (needed for generation, not for listings). */
  includeCode?: boolean;
  /** Restrict to these user-problem ids. */
  userProblemIds?: string[];
  /** Only problems with at least one accepted solution (default true). */
  solvedOnly?: boolean;
}

/** Loads full problem records for a user with a fixed number of queries (no N+1). */
export async function loadProblems(
  db: Db,
  userId: string,
  opts: LoadOptions = {},
): Promise<StoredProblem[]> {
  const { includeCode = false, userProblemIds, solvedOnly = true } = opts;
  if (userProblemIds && userProblemIds.length === 0) return [];

  let base = db
    .selectFrom('user_problems as up')
    .innerJoin('problems as p', 'p.id', 'up.problem_id')
    .where('up.user_id', '=', userId)
    .select([
      'up.id as userProblemId',
      'p.id as problemId',
      'p.question_id',
      'p.frontend_id',
      'p.title',
      'p.title_slug',
      'p.difficulty',
      'p.directory_name',
      'p.is_paid_only',
      'up.status',
      'up.notes',
      'up.time_complexity',
      'up.space_complexity',
      'up.attempt_count',
      'up.accepted_count',
      'up.wrong_answer_count',
      'up.time_limit_exceeded_count',
      'up.memory_limit_exceeded_count',
      'up.runtime_error_count',
      'up.compile_error_count',
      'up.revision_count',
      'up.first_solved_at',
      'up.last_solved_at',
      'up.last_revised_at',
      'up.metadata_dirty',
    ]);
  if (userProblemIds) base = base.where('up.id', 'in', userProblemIds);
  if (solvedOnly) {
    base = base.where((eb) =>
      eb.exists(
        eb.selectFrom('solutions as s').select('s.id').whereRef('s.user_problem_id', '=', 'up.id'),
      ),
    );
  }
  const rows = await base.execute();
  if (rows.length === 0) return [];
  const wanted = new Set(rows.map((r) => r.userProblemId));

  const topicRows = await db
    .selectFrom('problem_topics as pt')
    .innerJoin('topics as t', 't.id', 'pt.topic_id')
    .innerJoin('user_problems as up', 'up.problem_id', 'pt.problem_id')
    .where('up.user_id', '=', userId)
    .select(['up.id as userProblemId', 't.name', 't.slug'])
    .orderBy('t.name')
    .execute();

  const patternRows = await db
    .selectFrom('user_problem_patterns as upp')
    .innerJoin('patterns as pa', 'pa.id', 'upp.pattern_id')
    .innerJoin('user_problems as up', 'up.id', 'upp.user_problem_id')
    .where('up.user_id', '=', userId)
    .select(['up.id as userProblemId', 'pa.name'])
    .orderBy('pa.name')
    .execute();

  const tagRows = await db
    .selectFrom('user_problem_tags as upt')
    .innerJoin('custom_tags as ct', 'ct.id', 'upt.tag_id')
    .innerJoin('user_problems as up', 'up.id', 'upt.user_problem_id')
    .where('up.user_id', '=', userId)
    .select(['up.id as userProblemId', 'ct.name'])
    .orderBy('ct.name')
    .execute();

  const solutionRows = await db
    .selectFrom('solutions as s')
    .innerJoin('user_problems as up', 'up.id', 's.user_problem_id')
    .where('up.user_id', '=', userId)
    .select([
      'up.id as userProblemId',
      's.language',
      's.runtime',
      's.memory',
      's.updated_at',
      's.code_hash',
      's.synced_code_hash',
      's.synced_repository_id',
    ])
    .$if(includeCode, (qb) => qb.select('s.code'))
    .execute();

  const attemptRows = includeCode
    ? await db
        .selectFrom('submissions')
        .where('user_id', '=', userId)
        .where('saved_attempt_path', 'is not', null)
        .where('code', 'is not', null)
        .select([
          'user_problem_id as userProblemId',
          'saved_attempt_path',
          'saved_attempt_kind',
          'saved_attempt_note',
          'language',
          'code',
          'submitted_at',
        ])
        .execute()
    : [];

  const contentRows = includeCode
    ? await db
        .selectFrom('problems as p')
        .innerJoin('user_problems as up', 'up.problem_id', 'p.id')
        .where('up.user_id', '=', userId)
        .where('p.content', 'is not', null)
        .select(['up.id as userProblemId', 'p.content'])
        .execute()
    : [];

  const group = <T extends { userProblemId: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      if (!wanted.has(item.userProblemId)) continue;
      const list = map.get(item.userProblemId) ?? [];
      list.push(item);
      map.set(item.userProblemId, list);
    }
    return map;
  };
  const topics = group(topicRows);
  const patterns = group(patternRows);
  const tags = group(tagRows);
  const solutions = group(solutionRows);
  const attempts = group(attemptRows);
  const contents = group(contentRows);

  return rows.map((r) => ({
    userProblemId: r.userProblemId,
    problemId: r.problemId,
    questionId: r.question_id,
    frontendId: r.frontend_id,
    title: r.title,
    titleSlug: r.title_slug,
    difficulty: r.difficulty,
    directoryName: r.directory_name,
    isPaidOnly: r.is_paid_only,
    content: contents.get(r.userProblemId)?.[0]?.content ?? null,
    topics: (topics.get(r.userProblemId) ?? []).map((t) => ({ name: t.name, slug: t.slug })),
    patterns: (patterns.get(r.userProblemId) ?? []).map((p) => p.name),
    customTags: (tags.get(r.userProblemId) ?? []).map((t) => t.name),
    status: r.status,
    notes: r.notes,
    timeComplexity: r.time_complexity,
    spaceComplexity: r.space_complexity,
    counts: {
      attempts: r.attempt_count,
      accepted: r.accepted_count,
      wrongAnswer: r.wrong_answer_count,
      timeLimitExceeded: r.time_limit_exceeded_count,
      memoryLimitExceeded: r.memory_limit_exceeded_count,
      runtimeError: r.runtime_error_count,
      compileError: r.compile_error_count,
      revisions: r.revision_count,
    },
    firstSolvedAt: r.first_solved_at,
    lastSolvedAt: r.last_solved_at,
    lastRevisedAt: r.last_revised_at,
    metadataDirty: r.metadata_dirty,
    solutions: (solutions.get(r.userProblemId) ?? []).map((s) => ({
      language: s.language,
      code: 'code' in s && typeof s.code === 'string' ? s.code : '',
      runtime: s.runtime,
      memory: s.memory,
      updatedAt: s.updated_at,
      codeHash: s.code_hash,
      syncedCodeHash: s.synced_code_hash,
      syncedRepositoryId: s.synced_repository_id,
    })),
    savedAttempts: (attempts.get(r.userProblemId) ?? []).map((a) => ({
      path: a.saved_attempt_path as string,
      kind: a.saved_attempt_kind as SaveAttemptKind,
      note: a.saved_attempt_note,
      language: a.language,
      code: a.code as string,
      submittedAt: a.submitted_at,
    })),
  }));
}

export async function findUserProblemBySlug(db: Db, userId: string, slug: string) {
  return db
    .selectFrom('user_problems as up')
    .innerJoin('problems as p', 'p.id', 'up.problem_id')
    .where('up.user_id', '=', userId)
    .where('p.title_slug', '=', slug)
    .select(['up.id as userProblemId', 'p.frontend_id', 'p.title', 'p.title_slug', 'p.difficulty'])
    .executeTakeFirst();
}
