import type { ReactNode } from 'react';
import type { ProblemSummaryDto } from '@lcsync/shared';
import { DifficultyBadge, StatusBadge } from './ui.js';

export function ProblemRow({
  problem,
  onOpen,
  leading,
  meta,
  actions,
}: {
  problem: ProblemSummaryDto;
  onOpen: (slug: string) => void;
  leading?: ReactNode;
  meta?: ReactNode;
  /** Buttons/links shown under the title (outside the clickable title area). */
  actions?: ReactNode;
}) {
  return (
    <div className="list-item">
      {leading}
      <div className="grow" style={{ minWidth: 0 }}>
        <button
          type="button"
          className="grow"
          onClick={() => onOpen(problem.slug)}
          style={{
            border: 0,
            background: 'none',
            padding: 0,
            textAlign: 'left',
            cursor: 'pointer',
            minWidth: 0,
            display: 'block',
            width: '100%',
          }}
        >
          <div className="row">
            <span className="faint mono">{problem.frontendId}.</span>
            <span className="truncate" style={{ fontWeight: 500 }}>
              {problem.title}
            </span>
          </div>
          {meta && <div className="small muted truncate">{meta}</div>}
        </button>
        {actions && <div style={{ marginTop: 4 }}>{actions}</div>}
      </div>
      <StatusBadge status={problem.status} />
      <DifficultyBadge difficulty={problem.difficulty} />
    </div>
  );
}
