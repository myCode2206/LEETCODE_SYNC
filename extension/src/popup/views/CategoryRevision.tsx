import { useMemo, useState } from 'react';
import { slugify } from '@lcsync/shared';
import type { ProblemSummaryDto } from '@lcsync/shared';
import { EMPTY_FILTERS, ProblemFilters, applyFilters } from '../../components/ProblemFilters.js';
import { Banner, DifficultyBadge, EmptyState, Spinner, StatusBadge } from '../../components/ui.js';
import { api } from '../../services/api.js';
import { errorMessage } from '../../utils/errors.js';
import { plural, relativeTime } from '../../utils/format.js';
import { useData } from '../data.js';
import type { Navigate, Route } from '../routes.js';

const DAY = 24 * 3600 * 1000;
const revisedToday = (p: ProblemSummaryDto) =>
  !!p.lastRevisedAt && Date.now() - new Date(p.lastRevisedAt).getTime() < DAY;

/** "Revise Arrays": every problem in a topic/pattern, with filters and a revision checklist. */
export function CategoryRevision({
  route,
  navigate,
  back,
}: {
  route: Extract<Route, { name: 'category' }>;
  navigate: Navigate;
  back: () => void;
}) {
  const { problems, patchProblem } = useData();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const inCategory = useMemo(
    () =>
      (problems ?? []).filter((p) =>
        route.kind === 'topic'
          ? p.topics.some((t) => t.slug === route.slug)
          : p.patterns.some((x) => slugify(x) === route.slug),
      ),
    [problems, route],
  );
  const shown = useMemo(() => applyFilters(inCategory, filters), [inCategory, filters]);

  const markRevised = async (p: ProblemSummaryDto) => {
    setBusy(p.slug);
    setError(null);
    try {
      const res = await api.addRevision({ problemSlug: p.slug });
      patchProblem(res.problem);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!problems) return <Spinner />;
  return (
    <div className="stack">
      <div className="row between">
        <button className="back" onClick={back}>
          ← Back
        </button>
      </div>
      <div>
        <h2 style={{ fontSize: 16 }}>{route.label} Revision</h2>
        <div className="muted small">
          {inCategory.length} problems · {inCategory.filter(revisedToday).length} revised today
        </div>
      </div>
      <ProblemFilters
        value={filters}
        onChange={setFilters}
        problems={inCategory}
        hide={[route.kind]}
      />
      {error && <Banner kind="error">{error}</Banner>}
      {shown.length ? (
        <div className="list">
          {shown.map((p) => (
            <div key={p.slug} className="list-item">
              <input
                type="checkbox"
                aria-label={`Mark ${p.title} as revised`}
                checked={revisedToday(p)}
                disabled={busy === p.slug || revisedToday(p)}
                onChange={() => void markRevised(p)}
              />
              <button
                type="button"
                className="grow"
                style={{
                  border: 0,
                  background: 'none',
                  padding: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  minWidth: 0,
                }}
                onClick={() => navigate({ name: 'problem', slug: p.slug })}
              >
                <div className="truncate" style={{ fontWeight: 500 }}>
                  <span className="faint mono">{p.frontendId}.</span> {p.title}
                </div>
                <div className="small muted">
                  {plural(p.revisionCount, 'revision')} · revised{' '}
                  {relativeTime(p.lastRevisedAt ?? p.lastSolvedAt)}
                </div>
              </button>
              <StatusBadge status={p.status} />
              <DifficultyBadge difficulty={p.difficulty} />
              <a
                className="small"
                href={p.leetcodeUrl}
                target="_blank"
                rel="noreferrer"
                title="Open on LeetCode"
              >
                LC
              </a>
              {p.githubUrl && (
                <a
                  className="small"
                  href={p.githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open solution on GitHub"
                >
                  GH
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>No problems match these filters.</EmptyState>
      )}
    </div>
  );
}
