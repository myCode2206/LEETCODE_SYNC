import { useState } from 'react';
import type { ProblemSummaryDto } from '@lcsync/shared';
import { ProblemRow } from '../../components/ProblemRow.js';
import { Banner, Button, EmptyState, Section, Spinner } from '../../components/ui.js';
import { api } from '../../services/api.js';
import { errorMessage } from '../../utils/errors.js';
import { plural, relativeTime } from '../../utils/format.js';
import { useData } from '../data.js';
import type { Navigate } from '../routes.js';

const WEEK = 7 * 24 * 3600 * 1000;

export function RevisionsView({ navigate }: { navigate: Navigate }) {
  const { problems, patchProblem } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  if (!problems) return <Spinner />;

  const byDue = (a: ProblemSummaryDto, b: ProblemSummaryDto) =>
    (a.dueAt ?? '').localeCompare(b.dueAt ?? '');
  const due = problems.filter((p) => p.isDue).sort(byDue);
  const upcoming = problems
    .filter((p) => !p.isDue && p.dueAt && new Date(p.dueAt).getTime() - now < WEEK)
    .sort(byDue);

  const revise = async (p: ProblemSummaryDto) => {
    setBusy(p.slug);
    setError(null);
    try {
      patchProblem((await api.addRevision({ problemSlug: p.slug })).problem);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const action = (p: ProblemSummaryDto) => (
    <div className="row">
      <a className="small" href={p.leetcodeUrl} target="_blank" rel="noreferrer">
        Solve
      </a>
      <Button size="sm" loading={busy === p.slug} onClick={() => void revise(p)}>
        ✓ Revised
      </Button>
    </div>
  );

  return (
    <div className="stack">
      {error && <Banner kind="error">{error}</Banner>}
      <Section title={`Due now (${due.length})`}>
        {due.length ? (
          <div className="list">
            {due.map((p) => (
              <ProblemRow
                key={p.slug}
                problem={p}
                onOpen={(slug) => navigate({ name: 'problem', slug })}
                meta={`Due ${relativeTime(p.dueAt)} · ${plural(p.revisionCount, 'revision')}`}
                actions={action(p)}
              />
            ))}
          </div>
        ) : (
          <EmptyState>
            Nothing is due. Problems come back 3–60 days after you solve them, depending on their
            status.
          </EmptyState>
        )}
      </Section>
      <Section title={`Coming up this week (${upcoming.length})`}>
        {upcoming.length ? (
          <div className="list">
            {upcoming.map((p) => (
              <ProblemRow
                key={p.slug}
                problem={p}
                onOpen={(slug) => navigate({ name: 'problem', slug })}
                meta={`Due ${relativeTime(p.dueAt)}`}
              />
            ))}
          </div>
        ) : (
          <div className="small muted">Nothing else this week.</div>
        )}
      </Section>
    </div>
  );
}
