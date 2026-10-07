import { useMemo, useState } from 'react';
import { EMPTY_FILTERS, ProblemFilters, applyFilters } from '../../components/ProblemFilters.js';
import { ProblemRow } from '../../components/ProblemRow.js';
import { Button, EmptyState, Spinner } from '../../components/ui.js';
import { getLanguage } from '@lcsync/shared';
import { useData } from '../data.js';
import type { Navigate } from '../routes.js';

const PAGE = 100;

/** Global search: number, title, topic, pattern, language, custom tag or difficulty. */
export function ProblemsView({ navigate }: { navigate: Navigate }) {
  const { problems } = useData();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const results = useMemo(() => applyFilters(problems ?? [], filters), [problems, filters]);

  if (!problems) return <Spinner label="Loading problems…" />;
  return (
    <div className="stack">
      <input
        className="input"
        type="search"
        autoFocus
        placeholder="Search: 1, two sum, array, sliding window, Google…"
        value={filters.q}
        onChange={(e) => {
          setFilters({ ...filters, q: e.target.value });
          setLimit(PAGE);
        }}
      />
      <ProblemFilters value={filters} onChange={setFilters} problems={problems} />
      <div className="small muted">
        {results.length} of {problems.length} problems
      </div>
      {results.length ? (
        <div className="list">
          {results.slice(0, limit).map((p) => (
            <ProblemRow
              key={p.slug}
              problem={p}
              onOpen={(slug) => navigate({ name: 'problem', slug })}
              meta={[
                p.topics.map((t) => t.name).join(', '),
                p.languages.map((l) => getLanguage(l).displayName).join(', '),
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </div>
      ) : (
        <EmptyState>
          {problems.length ? 'No problems match.' : 'No synced problems yet.'}
        </EmptyState>
      )}
      {results.length > limit && <Button onClick={() => setLimit(limit + PAGE)}>Show more</Button>}
    </div>
  );
}
