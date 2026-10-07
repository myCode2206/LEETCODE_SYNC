import { useEffect, useRef, useState } from 'react';
import type { GitHubAccessLevel, MeDto } from '@lcsync/shared';
import { useStorage } from '../hooks/useStorage.js';
import { sendToBackground } from '../services/messaging.js';
import type { PendingLogin } from '../storage/storage.js';
import { errorMessage } from '../utils/errors.js';
import { Banner, Button } from './ui.js';

/**
 * Access-level choice with an explanation of exactly what each GitHub scope allows. Connecting
 * creates a sign-in link that can be opened here or copied into another browser or profile.
 */
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
  const [pending] = useStorage('pendingLogin');
  const [me] = useStorage('me');

  // The background finishes sign-in (possibly while this page was closed) and clears the link.
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (pending && !pending.error) wasWaiting.current = true;
    else if (pending === null && wasWaiting.current) {
      wasWaiting.current = false;
      if (me?.github) onConnected?.(me);
    }
  }, [pending, me, onConnected]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendToBackground({ type: 'CREATE_SIGN_IN_LINK', access });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    wasWaiting.current = false;
    await sendToBackground({ type: 'CANCEL_SIGN_IN_LINK' }).catch(() => undefined);
  };

  if (pending && !pending.error) return <SignInLink pending={pending} onCancel={cancel} />;

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
      {(error ?? pending?.error) && <Banner kind="error">{error ?? pending?.error}</Banner>}
      <Button variant="primary" onClick={connect} loading={busy}>
        {label}
      </Button>
    </div>
  );
}

function SignInLink({ pending, onCancel }: { pending: PendingLogin; onCancel: () => void }) {
  const [copied, setCopied] = useState(false);
  const minutesLeft = useMinutesLeft(pending.expiresAt);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pending.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the field stays selectable for manual copying */
    }
  };

  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        Sign in to GitHub here, or copy the link into any other browser or Chrome profile. This
        extension connects automatically once you approve.
      </p>
      <Button variant="primary" onClick={() => void chrome.tabs.create({ url: pending.url })}>
        Open GitHub sign-in
      </Button>
      <div className="row">
        <input
          className="input grow"
          readOnly
          value={pending.url}
          aria-label="Sign-in link"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The page must show the code{' '}
        <strong>
          <code>{pending.code}</code>
        </strong>
        . Only continue if it matches.
      </p>
      <div className="row between">
        <span className="row small muted" role="status">
          <span className="spinner" aria-hidden />
          Waiting for approval
          {minutesLeft !== null && ` · link expires in ${minutesLeft} min`}
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function useMinutesLeft(expiresAt: string): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const ms = Date.parse(expiresAt) - now;
  return ms > 0 ? Math.ceil(ms / 60_000) : null;
}
