import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Difficulty, RevisionStatus } from '@lcsync/shared';
import { REVISION_STATUS_LABELS } from '@lcsync/shared';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'secondary' ? variant : '',
    size === 'sm' ? 'sm' : '',
    className,
  ].filter(Boolean);
  return (
    <button type="button" className={classes.join(' ')} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row muted" role="status">
      <span className="spinner" aria-hidden />
      {label && <span>{label}</span>}
    </div>
  );
}

export function Banner({
  kind,
  children,
  action,
}: {
  kind: 'error' | 'warning' | 'info' | 'success';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`badge ${difficulty.toLowerCase()}`}>{difficulty}</span>;
}

const STATUS_STYLE: Record<RevisionStatus, string> = {
  new: '',
  solved: 'accent',
  revised: 'success',
  need_revision: 'danger',
  difficult: 'danger',
  mastered: 'success',
};

export function StatusBadge({ status }: { status: RevisionStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{REVISION_STATUS_LABELS[status]}</span>;
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chip${active ? ' active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="section-title">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Easy / medium / hard proportions as a thin stacked bar. */
export function DifficultyBar({
  easy,
  medium,
  hard,
}: {
  easy: number;
  medium: number;
  hard: number;
}) {
  const total = easy + medium + hard || 1;
  return (
    <div className="bar" aria-label={`${easy} easy, ${medium} medium, ${hard} hard`}>
      <span style={{ width: `${(easy / total) * 100}%` }} />
      <span style={{ width: `${(medium / total) * 100}%` }} />
      <span style={{ width: `${(hard / total) * 100}%` }} />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        {description && <span className="muted small">{description}</span>}
      </span>
    </label>
  );
}
