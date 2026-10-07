import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_REPOSITORY_SETTINGS } from '@lcsync/shared';
import type { BranchDto, GitHubRepoDto, MeDto, RepositoryConfigDto } from '@lcsync/shared';
import { Banner, Button, Spinner } from '../../components/ui.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { sendToBackground } from '../../services/messaging.js';
import { chromeStorage } from '../../storage/storage.js';
import { errorMessage } from '../../utils/errors.js';

const storage = chromeStorage();

export function RepositorySection({ me }: { me: MeDto }) {
  const current = me.repository;
  const repos = useAsync(() => api.listRepositories(), []);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [repoId, setRepoId] = useState<number | null>(current?.githubRepoId ?? null);
  const [newName, setNewName] = useState('leetcode-solutions');
  const [newPrivate, setNewPrivate] = useState(false);
  const [branch, setBranch] = useState(current?.branch ?? '');
  const [rootDir, setRootDir] = useState(current?.rootDir ?? '');
  const [branchList, setBranchList] = useState<{ repoId: number; items: BranchDto[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<RepositoryConfigDto | null>(null);
  const [backfill, setBackfill] = useState<string | null>(null);

  const writable = useMemo(() => (repos.data ?? []).filter((r) => r.canPush), [repos.data]);
  const selected: GitHubRepoDto | undefined = writable.find((r) => r.id === repoId);
  const branches = branchList && branchList.repoId === repoId ? branchList.items : null;

  useEffect(() => {
    if (mode !== 'existing' || !repoId) return;
    let active = true;
    api
      .listBranches(repoId)
      .then((list) => {
        if (!active) return;
        setBranchList({ repoId, items: list });
        setBranch((b) =>
          list.some((x) => x.name === b) ? b : (selected?.defaultBranch ?? list[0]?.name ?? 'main'),
        );
      })
      .catch((err) => active && setError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, [repoId, mode, selected?.defaultBranch]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);
    setBackfill(null);
    try {
      let target = selected;
      let targetBranch = branch;
      if (mode === 'new') {
        target = await api.createRepository({
          name: newName.trim(),
          private: newPrivate,
          description: 'LeetCode solutions, synced automatically.',
        });
        targetBranch = target.defaultBranch;
        repos.reload();
      }
      if (!target) throw new Error('Choose a repository.');
      const repository = await api.configureRepository({
        githubRepoId: target.id,
        branch: targetBranch,
        rootDir,
        settings: current?.settings ?? DEFAULT_REPOSITORY_SETTINGS,
      });
      await storage.set('me', { ...me, repository });
      setSaved(repository);
      setMode('existing');
      setRepoId(repository.githubRepoId);
      void sendToBackground({ type: 'RETRY_QUEUE' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const writeAll = async () => {
    setBackfill('running');
    try {
      const result = await api.fullSync();
      setBackfill(result.message);
    } catch (err) {
      setBackfill(null);
      setError(errorMessage(err));
    }
  };

  const changed =
    mode === 'new' ||
    repoId !== current?.githubRepoId ||
    branch !== current?.branch ||
    rootDir !== (current?.rootDir ?? '');

  return (
    <section className="card" id="repository">
      <h2>Repository</h2>
      <p className="lead">
        Where solutions are committed. Each problem gets exactly one folder (
        <code>problems/0001-two-sum/</code>); topics, patterns, difficulty and languages link to it.
      </p>
      {current && (
        <Banner kind="success">
          Syncing to{' '}
          <a href={current.htmlUrl} target="_blank" rel="noreferrer">
            {current.fullName}
          </a>{' '}
          · branch <code>{current.branch}</code>
          {current.rootDir ? (
            <>
              {' '}
              · folder <code>/{current.rootDir}</code>
            </>
          ) : null}
          {current.private ? ' · private' : ' · public'}
        </Banner>
      )}

      <div className="stack" style={{ marginTop: 12 }}>
        <div className="chips">
          <button
            type="button"
            className={`chip${mode === 'existing' ? ' active' : ''}`}
            onClick={() => setMode('existing')}
          >
            Use an existing repository
          </button>
          <button
            type="button"
            className={`chip${mode === 'new' ? ' active' : ''}`}
            onClick={() => setMode('new')}
          >
            Create a new repository
          </button>
        </div>

        {mode === 'existing' ? (
          repos.loading ? (
            <Spinner label="Loading your repositories…" />
          ) : repos.error ? (
            <Banner kind="error">{errorMessage(repos.error)}</Banner>
          ) : (
            <div className="grid-2">
              <label className="field">
                <span>Repository</span>
                <select
                  className="select"
                  value={repoId ?? ''}
                  onChange={(e) => setRepoId(Number(e.target.value) || null)}
                >
                  <option value="">Choose…</option>
                  {writable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName}
                      {r.private ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Branch</span>
                <select
                  className="select"
                  value={branch}
                  disabled={!branches}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  {(branches ?? []).map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.protected ? ' (protected)' : ''}
                    </option>
                  ))}
                  {branches?.length === 0 && (
                    <option value={selected?.defaultBranch}>
                      {selected?.defaultBranch} (empty repository)
                    </option>
                  )}
                </select>
              </label>
            </div>
          )
        ) : (
          <div className="grid-2">
            <label className="field">
              <span>New repository name</span>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Visibility</span>
              <select
                className="select"
                value={newPrivate ? 'private' : 'public'}
                onChange={(e) => setNewPrivate(e.target.value === 'private')}
              >
                <option value="public">Public</option>
                <option value="private" disabled={me.github?.accessLevel !== 'private'}>
                  Private
                  {me.github?.accessLevel !== 'private' ? ' (reconnect with private access)' : ''}
                </option>
              </select>
            </label>
          </div>
        )}

        <label className="field">
          <span>Root folder (optional)</span>
          <input
            className="input"
            placeholder="/ (repository root)"
            value={rootDir}
            onChange={(e) => setRootDir(e.target.value)}
          />
        </label>

        {error && <Banner kind="error">{error}</Banner>}
        {saved && (
          <Banner
            kind="info"
            action={
              <Button
                size="sm"
                variant="primary"
                loading={backfill === 'running'}
                disabled={!!backfill && backfill !== 'running'}
                onClick={() => void writeAll()}
              >
                Write now
              </Button>
            }
          >
            Saved. Write all problems you've already synced into <strong>{saved.fullName}</strong>{' '}
            now? (Otherwise they're added with your next accepted submission.)
            {backfill && backfill !== 'running' && <div style={{ marginTop: 4 }}>✓ {backfill}</div>}
          </Banner>
        )}
        <div>
          <Button
            variant="primary"
            loading={saving}
            disabled={!changed || (mode === 'existing' && !selected)}
            onClick={() => void save()}
          >
            {mode === 'new' ? 'Create and use repository' : 'Save repository'}
          </Button>
        </div>
      </div>
    </section>
  );
}
