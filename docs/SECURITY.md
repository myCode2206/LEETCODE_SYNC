# Security

## Credentials

| Secret                | Where it lives                                      | Protection                                                                   |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| GitHub OAuth token    | Backend DB `github_accounts.access_token_encrypted` | AES-256-GCM with `TOKEN_ENCRYPTION_KEY`; never logged or returned by the API |
| OAuth client secret   | Backend environment only                            | Never sent to the extension                                                  |
| Backend session token | Extension `chrome.storage.local`                    | Server stores only its SHA-256; revocable; expires (sliding 30 days)         |
| OAuth `state`         | Backend DB (hashed)                                 | One-time use, 10-minute TTL                                                  |
| Login hand-off code   | Backend DB (hashed)                                 | One-time use, 2-minute TTL                                                   |

No GitHub credential is ever stored in the browser, and none is hardcoded anywhere.

## OAuth flow and permissions

1. The extension calls `chrome.identity.launchWebAuthFlow` →
   `GET /api/v1/auth/github?redirect_uri=https://<ext-id>.chromiumapp.org/github`.
2. The backend accepts the `redirect_uri` only if it is HTTPS on `<allowed-id>.chromiumapp.org`.
   This stops the login code from being sent to any other site.
3. GitHub redirects to the backend callback. The backend checks `state`, then exchanges the
   code server-side using the client secret.
4. The extension receives only a one-time code, which it exchanges for a session via `POST`. No
   token ever appears in a URL.

The scopes requested are the minimum GitHub OAuth Apps allow:

| User choice              | Scope         | Why                                                           |
| ------------------------ | ------------- | ------------------------------------------------------------- |
| Public repositories only | `public_repo` | Create a public repository and commit to it                   |
| Public and private       | `repo`        | GitHub has no narrower scope that covers private repositories |

No user-profile or email scope is requested, because `GET /user` works with any token. The
extension only ever writes to the one repository the user chooses. For per-repository
permissions, a GitHub App can implement the same `GitHubApi` interface without other changes.

"Disconnect GitHub" revokes the grant at GitHub (`DELETE /applications/{client_id}/grant`),
deletes the stored token, and ends every session.

## Extension hardening

- **Permissions:** `storage`, `alarms`, `notifications` and `identity`, with host access limited
  to `https://leetcode.com/*` and the API origin.
- **The page hook only reads.** It observes two endpoints, reads response clones, never changes
  a request, and swallows its own errors.
- **Forged page messages.** The isolated script only accepts `postMessage` events from the
  same window and origin. It confirms accepted submissions through LeetCode's
  `submissionDetails` API, and the backend validates every field with zod.
- **Sender checks in the service worker.** Content messages are accepted only from
  `https://leetcode.com/` tabs; UI messages only from the extension's own pages.
- **CSP:** `script-src 'self'`, with no remote code and no `eval`. Code from GitHub or
  LeetCode is never executed.
- **Failed submissions** only send a SHA-256 of the code, never the code itself.

## Backend hardening

- `helmet`, a JSON body limit of 512 KB, and per-IP rate limits (30/min for auth, 300/min
  otherwise).
- CORS is restricted to `chrome-extension://<allowed ids>`.
- Every input is validated with zod. Paths are normalized and `..` is rejected for the root
  directory.
- All SQL is parameterized through Kysely.
- The generator only deletes files inside the index directories it owns (`topics/`,
  `patterns/`, `difficulty/`, `languages/`, `stats/`), and only `.md`/`.json` files there.
  Nothing under `problems/` or outside the root directory is ever deleted.
- The root README is merged between markers, so the user's own text is preserved.
- Logs are structured JSON, and keys matching token, secret, authorization, password or cookie
  are redacted.

## Known advisories

`npm audit` reports one low-severity esbuild issue (GHSA-g7r4-m6w7-qqqr): arbitrary file reads
through esbuild's **dev server on Windows**. It comes in through `tsup`, which pins esbuild
0.27, only at build time. This project never runs esbuild's dev server, so it isn't
exploitable here.

## Reporting

Please report vulnerabilities privately to the maintainers rather than opening a public issue.
