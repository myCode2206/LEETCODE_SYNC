import { useState } from 'react';
import type { CategoryCountDto } from '@lcsync/shared';
import { Banner, Button, DifficultyBar, EmptyState, Section } from '../../components/ui.js';
import { ProblemRow } from '../../components/ProblemRow.js';
import { useStorage } from '../../hooks/useStorage.js';
import { api } from '../../services/api.js';
import { sendToBackground } from '../../services/messaging.js';
import { errorMessage } from '../../utils/errors.js';
import { plural, relativeTime } from '../../utils/format.js';
import { useData } from '../data.js';
import type { Navigate } from '../routes.js';

export function Dashboard({ navigate }: { navigate: Navigate }) {
  const { stats, problems, error, offline, refresh } = useData();
  const [me] = useStorage('me');
  const [queue] = useStorage('syncQueue');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const pending = queue?.filter((i) => i.state === 'pending') ?? [];
  const held = queue?.filter((i) => i.state === 'held') ?? [];
  const attention = queue?.filter((i) => i.state === 'needs_attention') ?? [];
  const due = (problems ?? [])
    .filter((p) => p.isDue)
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  const array = stats?.topics.find((t) => t.slug === 'array');

  return (
    <div className="stack">
      {me?.github?.needsReconnect && (
        <Banner
          kind="error"
          action={
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'reconnect'}
              onClick={() =>
                run('reconnect', () =>
                  sendToBackground({ type: 'CONNECT_GITHUB', access: me.github!.accessLevel }),
                )
              }
            >
              Reconnect
            </Button>
          }
        >
          GitHub authorization has expired. Please reconnect GitHub.
        </Banner>
      )}
      {me && !me.repository && (
        <Banner
          kind="info"
          action={
            <Button size="sm" onClick={() => void chrome.runtime.openOptionsPage()}>
              Choose
            </Button>
          }
        >
          Choose a GitHub repository to start syncing.
        </Banner>
      )}
      {offline && error != null && (
        <Banner kind="warning">{errorMessage(error)} Showing saved data.</Banner>
      )}
      {actionError && <Banner kind="error">{actionError}</Banner>}

      {attention.length > 0 && (
        <Banner
          kind="error"
          action={
            <Button
              size="sm"
              loading={busy === 'retry'}
              onClick={() => run('retry', () => sendToBackground({ type: 'RETRY_QUEUE' }))}
            >
              Retry
            </Button>
          }
        >
          <strong>{plural(attention.length, 'sync')} need attention.</strong>{' '}
          {attention[0]!.lastError?.message}
        </Banner>
      )}
      {pending.length > 0 && (
        <Banner
          kind="warning"
          action={
            <Button
              size="sm"
              loading={busy === 'retry'}
              onClick={() => run('retry', () => sendToBackground({ type: 'RETRY_QUEUE' }))}
            >
              Retry now
            </Button>
          }
        >
          Pending syncs: {pending.length}
          {pending[0]!.lastError && (
            <span className="muted"> — {pending[0]!.lastError.message}</span>
          )}
        </Banner>
      )}
      {held.map((item) => (
        <Banner
          key={item.id}
          kind="info"
          action={
            <div className="row">
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  run(item.id, () => sendToBackground({ type: 'APPROVE_ITEM', id: item.id }))
                }
              >
                Sync
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  run(item.id, () => sendToBackground({ type: 'DISCARD_ITEM', id: item.id }))
                }
              >
                Skip
              </Button>
            </div>
          }
        >
          New accepted solution: <strong>{item.title}</strong>
        </Banner>
      ))}
      {stats && stats.pendingCommitCount > 0 && (
        <Banner
          kind="info"
          action={
            <Button
              size="sm"
              loading={busy === 'push'}
              onClick={() => run('push', () => api.pushPending())}
            >
              Push now
            </Button>
          }
        >
          {plural(stats.pendingCommitCount, 'problem')} saved but not yet on GitHub.
        </Banner>
      )}

      <div className="stats-grid">
        <div className="stat">
          <div className="value">{stats?.total ?? '—'}</div>
          <div className="label">Problems solved</div>
        </div>
        <div className="stat easy">
          <div className="value">{stats?.easy ?? '—'}</div>
          <div className="label">Easy</div>
        </div>
        <div className="stat medium">
          <div className="value">{stats?.medium ?? '—'}</div>
          <div className="label">Medium</div>
        </div>
        <div className="stat hard">
          <div className="value">{stats?.hard ?? '—'}</div>
          <div className="label">Hard</div>
        </div>
      </div>

      <Section
        title={`Due for revision (${due.length})`}
        action={
          due.length > 0 && (
            <button className="back" onClick={() => navigate({ name: 'revisions' })}>
              See all
            </button>
          )
        }
      >
        {due.length ? (
          <div className="list">
            {due.slice(0, 3).map((p) => (
              <ProblemRow
                key={p.slug}
                problem={p}
                onOpen={(slug) => navigate({ name: 'problem', slug })}
                meta={`Solved ${relativeTime(p.lastSolvedAt)}`}
              />
            ))}
          </div>
        ) : (
          <div className="small muted">Nothing due — nice work.</div>
        )}
      </Section>

      <Section
        title="Top topics"
        action={
          array && (
            <Button
              size="sm"
              onClick={() =>
                navigate({ name: 'category', kind: 'topic', slug: array.slug, label: array.name })
              }
            >
              Revise Arrays
            </Button>
          )
        }
      >
        <CategoryList
          items={stats?.topics.slice(0, 5) ?? []}
          onRevise={(c) =>
            navigate({ name: 'category', kind: 'topic', slug: c.slug, label: c.name })
          }
          empty="Topics appear after your first sync."
        />
      </Section>

      <Section title="Top patterns">
        <CategoryList
          items={stats?.patterns.slice(0, 5) ?? []}
          onRevise={(c) =>
            navigate({ name: 'category', kind: 'pattern', slug: c.slug, label: c.name })
          }
          empty="Add patterns (e.g. Sliding Window) to problems to see them here."
        />
      </Section>

      <Section title="Recent syncs">
        {stats?.recentSyncs.length ? (
          <div className="list">
            {stats.recentSyncs.slice(0, 5).map((job) => (
              <div key={job.id} className="list-item">
                <span
                  className={`status-dot ${job.status === 'failed' ? 'error' : job.outcome === 'committed' ? 'ok' : ''}`}
                />
                <div className="grow">
                  <div className="truncate">
                    {job.problemTitle ?? (job.kind === 'full' ? 'Repository sync' : 'Sync')}
                  </div>
                  <div className="small muted truncate">{job.message}</div>
                </div>
                <span className="small faint">{relativeTime(job.createdAt)}</span>
                {job.commitUrl && (
                  <a className="small" href={job.commitUrl} target="_blank" rel="noreferrer">
                    commit
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>Submit an accepted solution on LeetCode to see it here.</EmptyState>
        )}
      </Section>
    </div>
  );
}

function CategoryList({
  items,
  onRevise,
  empty,
}: {
  items: CategoryCountDto[];
  onRevise: (c: CategoryCountDto) => void;
  empty: string;
}) {
  if (!items.length) return <div className="small muted">{empty}</div>;
  return (
    <div className="list">
      {items.map((c) => (
        <div key={c.slug} className="list-item category-row">
          <span className="truncate">{c.name}</span>
          <strong style={{ textAlign: 'right' }}>{c.count}</strong>
          <DifficultyBar easy={c.easy} medium={c.medium} hard={c.hard} />
          <Button size="sm" variant="ghost" onClick={() => onRevise(c)}>
            Revise
          </Button>
        </div>
      ))}
    </div>
  );
}
