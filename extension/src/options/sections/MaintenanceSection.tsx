import { useState } from 'react';
import { Banner, Button, EmptyState } from '../../components/ui.js';
import { useStorage } from '../../hooks/useStorage.js';
import { api } from '../../services/api.js';
import { sendToBackground } from '../../services/messaging.js';
import { errorMessage } from '../../utils/errors.js';
import { relativeTime } from '../../utils/format.js';

const STATE_LABEL = {
  pending: 'Waiting to retry',
  held: 'Waiting for approval',
  needs_attention: 'Needs attention',
} as const;

export function MaintenanceSection({ connected }: { connected: boolean }) {
  const [queue] = useStorage('syncQueue');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const run = async (
    key: string,
    fn: () => Promise<{ message?: string } | unknown>,
    confirmText?: string,
  ) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(key);
    setMessage(null);
    try {
      const result = (await fn()) as { message?: string } | undefined;
      setMessage({ kind: 'success', text: result?.message ?? 'Done.' });
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" id="maintenance">
      <h2>Queue &amp; maintenance</h2>
      <p className="lead">
        Detected solutions are stored in this browser until the server confirms them, so nothing is
        lost while offline. Retries are automatic and never create duplicate commits.
      </p>
      {queue && queue.length > 0 ? (
        <div className="list">
          {queue.map((item) => (
            <div key={item.id} className="list-item">
              <div className="grow">
                <strong>{item.title}</strong> <span className="small muted">· {item.status}</span>
                <div className="small muted">
                  {STATE_LABEL[item.state]} · detected{' '}
                  {relativeTime(new Date(item.createdAt).toISOString())}
                  {item.attempts > 0 && ` · ${item.attempts} attempts`}
                </div>
                {item.lastError && (
                  <div className="small" style={{ color: 'var(--danger)' }}>
                    {item.lastError.message}
                  </div>
                )}
              </div>
              {item.state === 'held' && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void sendToBackground({ type: 'APPROVE_ITEM', id: item.id })}
                >
                  Sync
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  confirm(`Discard ${item.title}? It will not be synced.`) &&
                  void sendToBackground({ type: 'DISCARD_ITEM', id: item.id })
                }
              >
                Discard
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>No pending syncs.</EmptyState>
      )}
      <div className="row wrap" style={{ marginTop: 12 }}>
        <Button
          loading={busy === 'retry'}
          disabled={!queue?.length}
          onClick={() =>
            run('retry', () =>
              sendToBackground({ type: 'RETRY_QUEUE' }).then(() => ({
                message: 'Retried pending syncs.',
              })),
            )
          }
        >
          Retry pending now
        </Button>
        <Button
          loading={busy === 'push'}
          disabled={!connected}
          onClick={() => run('push', () => api.pushPending())}
        >
          Push unsynced problems
        </Button>
        <Button
          loading={busy === 'full'}
          disabled={!connected}
          onClick={() =>
            run(
              'full',
              () => api.fullSync(),
              'Rebuild the repository? Every generated file is rewritten in one commit. Your own files are not touched.',
            )
          }
        >
          Rebuild repository
        </Button>
      </div>
      {message && (
        <div style={{ marginTop: 12 }}>
          <Banner kind={message.kind}>{message.text}</Banner>
        </div>
      )}
    </section>
  );
}
