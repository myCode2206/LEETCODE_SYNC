import { useState } from 'react';
import type { MeDto } from '@lcsync/shared';
import { ConnectGitHub } from '../../components/ConnectGitHub.js';
import { Banner, Button } from '../../components/ui.js';
import { sendToBackground } from '../../services/messaging.js';
import { errorMessage } from '../../utils/errors.js';

export function AccountSection({ me }: { me: MeDto | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const github = me?.github;

  const run = async (
    key: string,
    message: Parameters<typeof sendToBackground>[0],
    confirmText?: string,
  ) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(key);
    setError(null);
    try {
      await sendToBackground(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" id="github">
      <h2>GitHub account</h2>
      <p className="lead">
        Sign-in happens on github.com. Your GitHub token is stored encrypted on the sync server and
        never in the browser.
      </p>
      {!github ? (
        <ConnectGitHub />
      ) : (
        <div className="stack">
          {github.needsReconnect && (
            <Banner kind="error">GitHub authorization has expired. Please reconnect GitHub.</Banner>
          )}
          <div className="row">
            {github.avatarUrl && <img className="avatar" src={github.avatarUrl} alt="" />}
            <div className="grow">
              <strong>{github.login}</strong>
              <div className="small muted">
                {github.accessLevel === 'private'
                  ? 'Public and private repositories'
                  : 'Public repositories only'}{' '}
                · scope: <code>{github.scopes.join(', ') || 'none'}</code>
              </div>
            </div>
            <Button onClick={() => setReconnecting(!reconnecting)}>
              {reconnecting ? 'Cancel' : 'Reconnect / change access'}
            </Button>
          </div>
          {reconnecting && (
            <div className="card subtle">
              <ConnectGitHub
                initialAccess={github.accessLevel}
                label="Reconnect GitHub"
                onConnected={() => setReconnecting(false)}
              />
            </div>
          )}
          {error && <Banner kind="error">{error}</Banner>}
          <div className="row">
            <Button
              loading={busy === 'signout'}
              onClick={() => run('signout', { type: 'SIGN_OUT' })}
            >
              Sign out of this browser
            </Button>
            <Button
              variant="danger"
              loading={busy === 'disconnect'}
              onClick={() =>
                run(
                  'disconnect',
                  { type: 'DISCONNECT_GITHUB' },
                  'Disconnect GitHub? The app authorization is revoked and the stored token deleted. Your repository and your synced history are kept.',
                )
              }
            >
              Disconnect GitHub
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
