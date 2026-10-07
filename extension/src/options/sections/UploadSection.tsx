import { useState } from 'react';
import type { RepositoryConfigDto } from '@lcsync/shared';
import { Banner, Button } from '../../components/ui.js';
import { api } from '../../services/api.js';
import { errorMessage } from '../../utils/errors.js';
import { useRepositorySettings } from '../useRepositorySettings.js';

const CHOICES = [
  {
    value: true,
    title: 'Questions and solutions',
    description:
      'Each problem README contains the full LeetCode question (description, examples, constraints, images) above your code. Best for revision.',
  },
  {
    value: false,
    title: 'Solutions only',
    description: 'Only your code, links and notes. The question stays on LeetCode.',
  },
] as const;

/** Whether problem questions are uploaded to GitHub, as a clear either/or choice. */
export function UploadSection({ repository }: { repository: RepositoryConfigDto }) {
  const { save, saving, error } = useRepositorySettings();
  const current = repository.settings.includeProblemStatement;
  const [changed, setChanged] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const choose = async (value: boolean) => {
    if (value === current) return;
    await save({ includeProblemStatement: value });
    setChanged(true);
    setApplied(null);
  };

  const applyNow = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      setApplied((await api.fullSync()).message);
      setChanged(false);
    } catch (err) {
      setApplyError(errorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="card" id="upload">
      <h2>What to upload</h2>
      <p className="lead">
        Choose whether the LeetCode question is saved on GitHub along with your solution.
      </p>

      <div role="radiogroup" aria-label="What to upload">
        {CHOICES.map((c) => (
          <label key={String(c.value)} className="toggle">
            <input
              type="radio"
              name="upload-questions"
              checked={current === c.value}
              disabled={saving}
              onChange={() => void choose(c.value)}
            />
            <span>
              <strong>
                {c.title}
                {c.value && (
                  <span className="badge accent" style={{ marginLeft: 8 }}>
                    Recommended
                  </span>
                )}
              </strong>
              <span className="muted small">{c.description}</span>
            </span>
          </label>
        ))}
      </div>

      {current && !repository.private && (
        <div className="small muted" style={{ marginTop: 4 }}>
          Your repository is public: question texts belong to LeetCode, so premium (paid-only)
          questions are never uploaded to it. In a private repository they are.
        </div>
      )}

      {changed && !applied && (
        <div style={{ marginTop: 12 }}>
          <Banner
            kind="info"
            action={
              <Button
                size="sm"
                variant="primary"
                loading={applying}
                onClick={() => void applyNow()}
              >
                Update now
              </Button>
            }
          >
            Saved. New syncs use this choice. Update the problems already on GitHub too? (one
            commit)
          </Banner>
        </div>
      )}
      {applied && (
        <div style={{ marginTop: 12 }}>
          <Banner kind="success">✓ {applied}</Banner>
        </div>
      )}
      {(error || applyError) && (
        <div style={{ marginTop: 12 }}>
          <Banner kind="error">{error ?? applyError}</Banner>
        </div>
      )}
    </section>
  );
}
