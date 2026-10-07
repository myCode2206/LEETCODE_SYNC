import { useMemo } from 'react';
import { DIFFICULTIES, filterProblems, getLanguage, slugify } from '@lcsync/shared';
import type { Difficulty, ProblemSummaryDto } from '@lcsync/shared';
import { Chip } from './ui.js';

export type StatusFilter = 'all' | 'solved' | 'not_revised' | 'need_revision' | 'due';

export interface FilterState {
  q: string;
  difficulty: Difficulty | 'all';
  status: StatusFilter;
  language: string;
  pattern: string;
  tag: string;
  topic: string;
}

export const EMPTY_FILTERS: FilterState = {
  q: '',
  difficulty: 'all',
  status: 'all',
  language: '',
  pattern: '',
  tag: '',
  topic: '',
};

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'solved', label: 'Solved' },
  { value: 'not_revised', label: 'Not revised' },
  { value: 'need_revision', label: 'Need revision' },
  { value: 'due', label: 'Due' },
];

export function applyFilters(
  problems: readonly ProblemSummaryDto[],
  f: FilterState,
): ProblemSummaryDto[] {
  const base = filterProblems(problems, {
    q: f.q || undefined,
    difficulty: f.difficulty === 'all' ? undefined : f.difficulty,
    language: f.language || undefined,
    pattern: f.pattern || undefined,
    tag: f.tag || undefined,
    topic: f.topic || undefined,
  });
  switch (f.status) {
    case 'solved':
      return base.filter((p) => p.status === 'solved');
    case 'not_revised':
      return base.filter((p) => p.revisionCount <= 1);
    case 'need_revision':
      return base.filter((p) => p.status === 'need_revision' || p.status === 'difficult');
    case 'due':
      return base.filter((p) => p.isDue);
    default:
      return base;
  }
}

function uniqueSorted(values: { value: string; label: string }[]) {
  const map = new Map(values.map((v) => [v.value, v.label]));
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

export function ProblemFilters({
  value,
  onChange,
  problems,
  hide = [],
}: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  problems: readonly ProblemSummaryDto[];
  hide?: ('topic' | 'pattern')[];
}) {
  const options = useMemo(
    () => ({
      languages: uniqueSorted(
        problems.flatMap((p) =>
          p.languages.map((l) => ({ value: l, label: getLanguage(l).displayName })),
        ),
      ),
      patterns: uniqueSorted(
        problems.flatMap((p) => p.patterns.map((x) => ({ value: slugify(x), label: x }))),
      ),
      tags: uniqueSorted(
        problems.flatMap((p) => p.customTags.map((x) => ({ value: slugify(x), label: x }))),
      ),
      topics: uniqueSorted(
        problems.flatMap((p) => p.topics.map((t) => ({ value: t.slug, label: t.name }))),
      ),
    }),
    [problems],
  );
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  const select = (
    key: 'language' | 'pattern' | 'tag' | 'topic',
    label: string,
    opts: [string, string][],
  ) =>
    opts.length > 0 && (
      <select
        className="select grow"
        aria-label={label}
        value={value[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      >
        <option value="">{label}</option>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );

  return (
    <div className="stack tight">
      <div className="chips">
        <Chip active={value.difficulty === 'all'} onClick={() => set({ difficulty: 'all' })}>
          All
        </Chip>
        {DIFFICULTIES.map((d) => (
          <Chip key={d} active={value.difficulty === d} onClick={() => set({ difficulty: d })}>
            {d}
          </Chip>
        ))}
      </div>
      <div className="chips">
        {STATUS_CHIPS.map((s) => (
          <Chip
            key={s.value}
            active={value.status === s.value}
            onClick={() => set({ status: s.value })}
          >
            {s.label}
          </Chip>
        ))}
      </div>
      <div className="row">
        {select('language', 'Language', options.languages)}
        {!hide.includes('pattern') && select('pattern', 'Pattern', options.patterns)}
        {select('tag', 'Tag', options.tags)}
        {!hide.includes('topic') && select('topic', 'Topic', options.topics)}
      </div>
    </div>
  );
}
