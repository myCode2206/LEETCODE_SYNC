import { API_BASE_URL } from '../../services/api-client.js';

export function PrivacySection() {
  return (
    <section className="card privacy" id="privacy">
      <h2>Privacy</h2>
      <p className="lead">Exactly what is stored and where.</p>
      <dl>
        <dt>Read from LeetCode</dt>
        <dd>
          Only your own submissions on leetcode.com: the submit request (code, language) and its
          judge result, plus the problem's public metadata (number, title, difficulty, topics). The
          extension never reads other pages, cookies for other sites, or browsing history.
        </dd>
        <dt>Sent to the sync server ({new URL(API_BASE_URL).host})</dt>
        <dd>
          For accepted submissions: problem metadata, language, code, runtime, memory and timestamp.
          For failed submissions (only if "Sync failed submissions" is on): status, language and a
          hash of the code — never the code itself. Plus the patterns, tags, notes and statuses you
          edit.
        </dd>
        <dt>Stored on the sync server</dt>
        <dd>
          Your GitHub user id, login and avatar URL; your GitHub OAuth token, encrypted
          (AES-256-GCM); a hash of your session token; your problems, solutions, submission history
          and revisions; your repository choice.
        </dd>
        <dt>Stored in this browser</dt>
        <dd>
          A session token for the sync server (not a GitHub credential), your settings, pending
          syncs that have not been confirmed yet, and a cache of your problem list for offline
          viewing.
        </dd>
        <dt>Written to GitHub</dt>
        <dd>
          Only to the repository and folder you choose: accepted solutions, generated README/index
          files, and attempts you explicitly save.
        </dd>
        <dt>Removing your data</dt>
        <dd>
          "Disconnect GitHub" revokes the app's authorization at GitHub, deletes the stored token
          and signs out every browser. Removing the extension deletes all local data.
        </dd>
      </dl>
    </section>
  );
}
