import type { CheckEvent, SubmitEvent } from './protocol.js';

const MAX_TRACKED = 100;

/**
 * Correlates a submit event with its final check result and makes sure each submission is
 * handled once, even though LeetCode polls the check endpoint repeatedly.
 */
export class SubmissionTracker {
  private readonly submits = new Map<string, SubmitEvent>();
  private readonly handled = new Set<string>();

  onSubmit(event: SubmitEvent): void {
    this.submits.set(event.submissionId, event);
    trim(this.submits);
  }

  isHandled(submissionId: string): boolean {
    return this.handled.has(submissionId);
  }

  /** Returns the pair the first time a final result for a submission is seen; afterwards null. */
  onCheck(event: CheckEvent): { submit: SubmitEvent | null; check: CheckEvent } | null {
    if (this.handled.has(event.submissionId)) return null;
    this.handled.add(event.submissionId);
    trim(this.handled);
    const submit = this.submits.get(event.submissionId) ?? null;
    this.submits.delete(event.submissionId);
    return { submit, check: event };
  }
}

function trim(collection: Map<string, unknown> | Set<string>): void {
  while (collection.size > MAX_TRACKED) {
    const oldest = collection.keys().next().value;
    if (oldest === undefined) return;
    collection.delete(oldest);
  }
}
