import type { MeDto, SolutionUpdatePolicy } from '@lcsync/shared';
import { Banner, Toggle } from '../../components/ui.js';
import { useStorage } from '../../hooks/useStorage.js';
import { DEFAULT_SETTINGS } from '../../storage/settings.js';
import type { ExtensionSettings } from '../../storage/settings.js';
import { useRepositorySettings } from '../useRepositorySettings.js';

export function SyncSection({ me }: { me: MeDto | null }) {
  const [stored, setStored] = useStorage('settings');
  const settings = stored ?? DEFAULT_SETTINGS;
  const set = (patch: Partial<ExtensionSettings>) => void setStored({ ...settings, ...patch });
  const repo = me?.repository ?? null;
  const remote = useRepositorySettings();

  return (
    <section className="card" id="sync">
      <h2>Sync</h2>
      <p className="lead">What happens when LeetCode judges your submission.</p>
      <Toggle
        checked={settings.autoSync}
        onChange={(autoSync) => set({ autoSync })}
        title="Auto-sync accepted submissions"
        description="Off: each accepted solution waits in the popup until you click Sync."
      />
      <Toggle
        checked={settings.commitAutomatically}
        onChange={(commitAutomatically) => set({ commitAutomatically })}
        title="Commit automatically"
        description='Off: solutions are saved to your history and pushed together with "Push now".'
      />
      <Toggle
        checked={settings.syncFailedSubmissions}
        onChange={(syncFailedSubmissions) => set({ syncFailedSubmissions })}
        title="Sync failed submissions"
        description="Count Wrong Answer / TLE / Runtime Error attempts in your stats. Failed code is never uploaded or committed."
      />
      <Toggle
        checked={settings.saveAttemptHistory}
        onChange={(saveAttemptHistory) => set({ saveAttemptHistory })}
        title="Save attempt history"
        description='Shows "Save attempt" on accepted submissions so you can keep a new approach in attempts/. Nothing is saved automatically.'
      />
      <Toggle
        checked={settings.notifications}
        onChange={(notifications) => set({ notifications })}
        title="Notifications"
        description='Show "✓ Two Sum synced to GitHub" after each sync. Errors are always shown.'
      />

      <div
        style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 12 }}
        className="stack"
      >
        {!repo && (
          <div className="small muted">
            Choose a repository to configure how existing solutions are updated.
          </div>
        )}
        {repo && (
          <>
            <label className="field">
              <span>Update GitHub solution when I submit the same problem again</span>
              <select
                className="select"
                value={repo.settings.solutionUpdatePolicy}
                disabled={remote.saving}
                onChange={(e) =>
                  void remote.save({ solutionUpdatePolicy: e.target.value as SolutionUpdatePolicy })
                }
              >
                <option value="latest">Yes — use my latest accepted solution (default)</option>
                <option value="best_runtime">Only if it is faster than the saved one</option>
                <option value="keep_first">No — keep my first accepted solution</option>
              </select>
              <span className="small muted" style={{ fontWeight: 400 }}>
                Previous versions are never deleted: Git history keeps every committed version.
              </span>
            </label>
            <Toggle
              checked={repo.settings.commitMetadataOnlyChanges}
              disabled={remote.saving}
              onChange={(commitMetadataOnlyChanges) =>
                void remote.save({ commitMetadataOnlyChanges })
              }
              title="Commit when only statistics change"
              description="Off (recommended): re-submitting identical code updates your stats without creating a commit."
            />
            {remote.error && <Banner kind="error">{remote.error}</Banner>}
          </>
        )}
      </div>
    </section>
  );
}
