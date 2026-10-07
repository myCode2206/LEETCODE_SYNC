export const REVISION_STATUSES = [
  'new',
  'solved',
  'revised',
  'need_revision',
  'difficult',
  'mastered',
] as const;

export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const REVISION_STATUS_LABELS: Record<RevisionStatus, string> = {
  new: 'New',
  solved: 'Solved',
  revised: 'Revised',
  need_revision: 'Need Revision',
  difficult: 'Difficult',
  mastered: 'Mastered',
};

/** Days after the last solve/revision before a problem is due again, per status. */
export const REVISION_INTERVAL_DAYS: Record<RevisionStatus, number> = {
  need_revision: 0,
  difficult: 3,
  new: 7,
  solved: 7,
  revised: 14,
  mastered: 60,
};

/** Accepted submissions closer together than this count as the same revision session. */
export const REVISION_SESSION_GAP_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a problem becomes due for revision. `null` if it was never solved. */
export function computeDueAt(status: RevisionStatus, lastActivityAt: Date | null): Date | null {
  if (!lastActivityAt) return null;
  return new Date(lastActivityAt.getTime() + REVISION_INTERVAL_DAYS[status] * DAY_MS);
}

export function isDue(status: RevisionStatus, lastActivityAt: Date | null, now: Date): boolean {
  const due = computeDueAt(status, lastActivityAt);
  return due !== null && due.getTime() <= now.getTime();
}

/** True if an accepted submission at `at` starts a new revision session. */
export function startsNewRevisionSession(previousAcceptedAt: Date | null, at: Date): boolean {
  if (!previousAcceptedAt) return true;
  return at.getTime() - previousAcceptedAt.getTime() >= REVISION_SESSION_GAP_HOURS * 60 * 60 * 1000;
}
