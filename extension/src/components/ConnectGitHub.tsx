import { useState } from 'react';
import type { GitHubAccessLevel, MeDto } from '@lcsync/shared';
import { sendToBackground } from '../services/messaging.js';
import { errorMessage } from '../utils/errors.js';
import { Banner, Button } from './ui.js';

/** Access-level choice with an explanation of exactly what each GitHub scope allows. */
export function ConnectGitHub({
  initialAccess = 'public',
  label = 'Connect GitHub',
  onConnected,
}: {
  initialAccess?: GitHubAccessLevel;
  label?: string;
  onConnected?: (me: MeDto) => void;
}) {
  const [access, setAccess] = useState<GitHubAccessLevel>(initialAccess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await sendToBackground<MeDto>({ type: 'CONNECT_GITHUB', access });
      onConnected?.(me);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted" style={{ marginBottom: 6 }}>
          Which repositories may the extension write to?
        </legend>
        <label className="toggle">
          <input
            type="radio"
            name="access"
            checked={access === 'public'}
            onChange={() => setAccess('public')}
          />
          <span>
            <strong>Public repositories only</strong>
            <span className="muted small">
              Requests the <code>public_repo</code> scope: create and commit to your public
              repositories.
            </span>
          </span>
        </label>
        <label className="toggle">
          <input
            type="radio"
            name="access"
            checked={access === 'private'}
            onChange={() => setAccess('private')}
          />
          <span>
            <strong>Public and private repositories</strong>
            <span className="muted small">
              Requests the <code>repo</code> scope. GitHub OAuth has no narrower option for private
              repositories; the extension only ever writes to the one repository you choose.
            </span>
          </span>
        </label>
      </fieldset>
      {error && <Banner kind="error">{error}</Banner>}
      <Button variant="primary" onClick={connect} loading={busy}>
        {label}
      </Button>
    </div>
  );
}
