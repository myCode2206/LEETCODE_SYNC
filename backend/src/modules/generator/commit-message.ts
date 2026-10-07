import { DEFAULT_COMMIT_TEMPLATE, getLanguage } from '@lcsync/shared';
import type { ChangeKind } from '@lcsync/shared';

export interface CommitMessageInput {
  changeKind: ChangeKind;
  frontendId: string;
  title: string;
  slug: string;
  difficulty: string;
  /** Language key of the solution that triggered the commit. */
  language?: string | null;
  /** Other pending problems included in the same commit. */
  additionalProblems?: number;
}

const ACTIONS: Record<ChangeKind, string> = {
  new_problem: 'add',
  new_language: 'add',
  improved: 'improve',
  metadata: 'update',
  none: 'update',
};

/**
 * Renders the commit template. Placeholders: {action} {id} {title} {slug} {difficulty}
 * {language} {languageSuffix}. Default: "leetcode: {action} #{id} {title}{languageSuffix}" →
 *   leetcode: add #1 Two Sum
 *   leetcode: add #1 Two Sum (C++)
 *   leetcode: improve #1 Two Sum
 */
export function buildCommitMessage(
  input: CommitMessageInput,
  template = DEFAULT_COMMIT_TEMPLATE,
): string {
  const language = input.language ? getLanguage(input.language).displayName : '';
  const values: Record<string, string> = {
    action: ACTIONS[input.changeKind],
    id: input.frontendId,
    title: input.title,
    slug: input.slug,
    difficulty: input.difficulty,
    language,
    languageSuffix: input.changeKind === 'new_language' && language ? ` (${language})` : '',
  };
  let message = template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
  if (input.changeKind === 'metadata' && !template.includes('{action}')) message += ' (metadata)';
  if (input.additionalProblems) message += ` (+${input.additionalProblems} more)`;
  return message
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function fullSyncMessage(problemCount: number): string {
  return `leetcode: sync ${problemCount} problem${problemCount === 1 ? '' : 's'}`;
}

export function saveAttemptMessage(frontendId: string, title: string, language: string): string {
  return `leetcode: save attempt for #${frontendId} ${title} (${getLanguage(language).displayName})`;
}
