import { useState } from 'react';
import {
  REVISION_STATUS_LABELS,
  REVISION_STATUSES,
  STATUS_LABELS,
  SUGGESTED_PATTERNS,
  getLanguage,
} from '@lcsync/shared';
import type {
  ProblemDetailDto,
  RevisionStatus,
  SaveAttemptKind,
  UpdateProblemInput,
} from '@lcsync/shared';
import { LabelEditor } from '../../components/LabelEditor.js';
import {
  Banner,
  Button,
  DifficultyBadge,
  Section,
  Spinner,
  StatusBadge,
} from '../../components/ui.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useStorage } from '../../hooks/useStorage.js';
import { api } from '../../services/api.js';
import type { MutationResult } from '../../services/api-client.js';
import { errorMessage } from '../../utils/errors.js';
import { relativeTime, shortDate } from '../../utils/format.js';
import { useData } from '../data.js';

interface Draft {
  patterns: string[];
  customTags: string[];
  status: RevisionStatus;
  timeComplexity: string;
  spaceComplexity: string;
  notes: string;
}

function draftOf(p: ProblemDetailDto): Draft {
  return {
    patterns: p.patterns,
    customTags: p.customTags,
    status: p.status,
    timeComplexity: p.timeComplexity ?? '',
    spaceComplexity: p.spaceComplexity ?? '',
    notes: p.notes ?? '',
  };
}

export function ProblemDetail({ slug, back }: { slug: string; back: () => void }) {
  const { data: problem, error, loading, setData } = useAsync(() => api.getProblem(slug), [slug]);
  const { stats, patchProblem } = useData();
  const [settings] = useStorage('settings');
  const [edited, setEdited] = useState<{ source: ProblemDetailDto; draft: Draft } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  const draft = problem ? (edited?.source === problem ? edited.draft : draftOf(problem)) : null;
  const setDraft = (next: Draft) => problem && setEdited({ source: problem, draft: next });

  if (loading && !problem) return <Spinner label="Loading problem…" />;
  if (error || !problem || !draft) {
    return (
      <div className="stack">
        <button className="back" onClick={back}>
          ← Back
        </button>
        <Banner kind="error">{errorMessage(error)}</Banner>
      </div>
    );
  }

  const apply = (res: MutationResult) => {
    setData(res.problem);
    patchProblem(res.problem);
    if (res.syncError) setNotice({ kind: 'warning', text: `Saved. ${res.syncError.message}` });
    else setNotice({ kind: 'success', text: res.sync?.message ?? 'Saved.' });
  };

  const run = async (key: string, fn: () => Promise<MutationResult>) => {
    setBusy(key);
    setNotice(null);
    try {
      apply(await fn());
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const original = draftOf(problem);
  const changes: UpdateProblemInput = {};
  if (JSON.stringify(draft.patterns) !== JSON.stringify(original.patterns))
    changes.patterns = draft.patterns;
  if (JSON.stringify(draft.customTags) !== JSON.stringify(original.customTags))
    changes.customTags = draft.customTags;
  if (draft.status !== original.status) changes.status = draft.status;
  if (draft.timeComplexity !== original.timeComplexity)
    changes.timeComplexity = draft.timeComplexity || null;
  if (draft.spaceComplexity !== original.spaceComplexity)
    changes.spaceComplexity = draft.spaceComplexity || null;
  if (draft.notes !== original.notes) changes.notes = draft.notes || null;
  const dirty = Object.keys(changes).length > 0;

  const patternSuggestions = [
    ...new Set([...SUGGESTED_PATTERNS, ...(stats?.patterns.map((p) => p.name) ?? [])]),
  ];
  const tagSuggestions = [
    ...new Set([
      'Google',
      'Amazon',
      'Microsoft',
      'Meta',
      'Important',
      'Must Revise',
      'Weak Topic',
      'Interview',
      'Frequently Asked',
      ...(stats?.customTags.map((t) => t.name) ?? []),
    ]),
  ];

  return (
    <div className="stack">
      <button className="back" onClick={back} style={{ alignSelf: 'flex-start' }}>
        ← Back
      </button>

      <div className="stack tight">
        <h2 style={{ fontSize: 16 }}>
          <span className="faint">{problem.frontendId}.</span> {problem.title}
        </h2>
        <div className="row wrap">
          <DifficultyBadge difficulty={problem.difficulty} />
          <StatusBadge status={problem.status} />
          {problem.isDue && <span className="badge danger">Due</span>}
          <span className="grow" />
          <a href={problem.leetcodeUrl} target="_blank" rel="noreferrer">
            LeetCode ↗
          </a>
          {problem.githubUrl && (
            <a href={problem.githubUrl} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          )}
        </div>
        {problem.topics.length > 0 && (
          <div className="chips">
            {problem.topics.map((t) => (
              <span key={t.slug} className="badge" title="Official LeetCode topic">
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <div className="kv">
        <div>
          <strong>{problem.attemptCount}</strong>
          <span>Attempts</span>
        </div>
        <div>
          <strong>{problem.acceptedCount}</strong>
          <span>Accepted</span>
        </div>
        <div>
          <strong>{problem.revisionCount}</strong>
          <span>Revisions</span>
        </div>
        <div>
          <strong>{problem.wrongAnswerCount}</strong>
          <span>Wrong answer</span>
        </div>
        <div>
          <strong>{problem.timeLimitExceededCount}</strong>
          <span>TLE</span>
        </div>
        <div>
          <strong>
            {problem.runtimeErrorCount +
              problem.compileErrorCount +
              problem.memoryLimitExceededCount}
          </strong>
          <span>Other errors</span>
        </div>
      </div>
      <div className="small muted">
        First solved {shortDate(problem.firstSolvedAt)} · Last solved{' '}
        {shortDate(problem.lastSolvedAt)} · Last revised {relativeTime(problem.lastRevisedAt)}
      </div>

      <div className="row">
        <Button
          variant="primary"
          loading={busy === 'revise'}
          onClick={() => run('revise', () => api.addRevision({ problemSlug: slug }))}
        >
          ✓ Mark revised today
        </Button>
        <select
          className="select grow"
          aria-label="Revision status"
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as RevisionStatus })}
        >
          {REVISION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REVISION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <LabelEditor
        label="Patterns"
        values={draft.patterns}
        suggestions={patternSuggestions}
        placeholder="Add a pattern, e.g. Sliding Window"
        onChange={(patterns) => setDraft({ ...draft, patterns })}
      />
      <LabelEditor
        label="Custom tags"
        values={draft.customTags}
        suggestions={tagSuggestions}
        placeholder="Add a tag, e.g. Google, Must Revise"
        onChange={(customTags) => setDraft({ ...draft, customTags })}
      />
      <div className="row">
        <label className="field grow">
          <span>Time complexity</span>
          <input
            className="input"
            placeholder="e.g. O(n)"
            value={draft.timeComplexity}
            onChange={(e) => setDraft({ ...draft, timeComplexity: e.target.value })}
          />
        </label>
        <label className="field grow">
          <span>Space complexity</span>
          <input
            className="input"
            placeholder="e.g. O(1)"
            value={draft.spaceComplexity}
            onChange={(e) => setDraft({ ...draft, spaceComplexity: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span>Notes (published in the problem README)</span>
        <textarea
          className="textarea"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
      <div className="row">
        <Button
          variant="primary"
          disabled={!dirty}
          loading={busy === 'save'}
          onClick={() => run('save', () => api.updateProblem(slug, changes))}
        >
          Save changes
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(original)}>
            Discard
          </Button>
        )}
      </div>

      <Section title="Solutions">
        <div className="list">
          {problem.solutions.map((s) => (
            <div key={s.language} className="list-item">
              <strong className="grow">{s.displayName}</strong>
              <span className="small muted">
                {[s.runtime, s.memory].filter(Boolean).join(' · ')}
              </span>
              {!s.synced && (
                <span className="badge" title="Not yet pushed to GitHub">
                  pending
                </span>
              )}
              {s.githubUrl && (
                <a className="small" href={s.githubUrl} target="_blank" rel="noreferrer">
                  View ↗
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Submissions">
        <div className="list">
          {problem.submissions.slice(0, 15).map((s) => (
            <div key={s.leetcodeSubmissionId} className="list-item">
              <span className={`status-dot ${s.status === 'accepted' ? 'ok' : 'error'}`} />
              <div className="grow">
                <div>{STATUS_LABELS[s.status]}</div>
                <div className="small muted">
                  {getLanguage(s.language).displayName} · {relativeTime(s.submittedAt)}
                  {s.runtime ? ` · ${s.runtime}` : ''}
                </div>
              </div>
              {s.savedAttemptPath ? (
                <span className="badge success" title={s.savedAttemptPath}>
                  saved
                </span>
              ) : (
                settings?.saveAttemptHistory &&
                s.hasCode && (
                  <SaveAttempt
                    busy={busy === s.leetcodeSubmissionId}
                    onSave={(kind) =>
                      run(s.leetcodeSubmissionId, () =>
                        api.saveAttempt(slug, {
                          leetcodeSubmissionId: s.leetcodeSubmissionId,
                          kind,
                        }),
                      )
                    }
                  />
                )
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function SaveAttempt({ busy, onSave }: { busy: boolean; onSave: (kind: SaveAttemptKind) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Save attempt
      </Button>
    );
  }
  return (
    <div className="row">
      <Button size="sm" loading={busy} onClick={() => onSave('new_approach')}>
        New approach
      </Button>
      <Button size="sm" loading={busy} onClick={() => onSave('important_revision')}>
        Important
      </Button>
    </div>
  );
}
