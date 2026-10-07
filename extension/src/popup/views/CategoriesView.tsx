import { useState } from 'react';
import { DifficultyBar, EmptyState, Spinner } from '../../components/ui.js';
import { useData } from '../data.js';
import type { CategoryKind, Navigate } from '../routes.js';

export function CategoriesView({ kind, navigate }: { kind: CategoryKind; navigate: Navigate }) {
  const { stats } = useData();
  const [q, setQ] = useState('');
  if (!stats) return <Spinner label="Loading…" />;
  const items = (kind === 'topic' ? stats.topics : stats.patterns).filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="stack">
      <input
        className="input"
        type="search"
        placeholder={kind === 'topic' ? 'Filter topics' : 'Filter patterns'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {items.length ? (
        <div className="list">
          {items.map((c) => (
            <button
              key={c.slug}
              type="button"
              className="list-item category-row"
              style={{ gridTemplateColumns: '1fr 36px 80px' }}
              onClick={() => navigate({ name: 'category', kind, slug: c.slug, label: c.name })}
            >
              <span className="truncate">{c.name}</span>
              <strong style={{ textAlign: 'right' }}>{c.count}</strong>
              <DifficultyBar easy={c.easy} medium={c.medium} hard={c.hard} />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState>
          {kind === 'topic'
            ? 'No topics yet.'
            : 'No patterns yet. Open a problem and add patterns such as "Sliding Window" or "Two Pointers".'}
        </EmptyState>
      )}
    </div>
  );
}
