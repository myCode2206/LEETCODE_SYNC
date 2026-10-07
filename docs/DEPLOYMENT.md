# Production deployment

## 1. Backend

Requirements: a managed PostgreSQL 14+ database and a host that runs Docker or Node 22+ behind
HTTPS.

```bash
docker build -f backend/Dockerfile -t lcsync-backend .
docker run -p 4000:4000 --env-file backend/.env.production lcsync-backend
```

Or without Docker:

```bash
npm ci && npm run build -w @lcsync/backend
node backend/dist/main.js               # migrations run automatically on start
# or run them separately: node backend/dist/database/migrate-cli.js
```

### Environment

| Variable                  | Production value                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`                | `production`                                                                              |
| `PUBLIC_BASE_URL`         | `https://lcsync.example.com` (must be HTTPS)                                              |
| `DATABASE_URL`            | `postgres://…?sslmode=require`                                                            |
| `GITHUB_CLIENT_ID/SECRET` | A **separate** OAuth App whose callback is `$PUBLIC_BASE_URL/api/v1/auth/github/callback` |
| `TOKEN_ENCRYPTION_KEY`    | `openssl rand -base64 32`, kept in a secret manager                                       |
| `ALLOWED_EXTENSION_IDS`   | The Chrome Web Store ID of the published extension (required)                             |
| `TRUST_PROXY`             | `1` when behind one reverse proxy/load balancer (needed for correct rate limiting)        |
| `SESSION_TTL_DAYS`        | Default `30`                                                                              |

The backend refuses to start if configuration is invalid. `GET /health` is the liveness
probe.

### Scaling

The service is stateless. Several instances can run at once:

- Duplicate sync requests are stopped by `UNIQUE (user_id, idempotency_key)` and
  `UNIQUE (user_id, leetcode_submission_id)`.
- Concurrent commits to the same branch are protected by fast-forward-only ref updates, with
  automatic rebuild-and-retry.

The in-process per-user lock is an optimization that avoids those retries. To get the same
effect across instances, route a user to one instance (sticky sessions) or replace
`KeyedMutex` with a Postgres advisory lock.

### Rotating the encryption key

Tokens that can't be decrypted are treated as expired. After a rotation, users are asked to
reconnect GitHub and nothing else is lost.

## 2. Extension

```bash
VITE_API_BASE_URL=https://lcsync.example.com npm run package -w @lcsync/extension
```

This builds `extension/dist` and zips it to `extension/release/` for the Chrome Web Store.
The manifest only requests `storage`, `alarms`, `notifications` and `identity`, plus host
access to `leetcode.com` and your API origin.

After the first upload, put the store-assigned extension ID into `ALLOWED_EXTENSION_IDS`.

## 3. Checklist

- [ ] HTTPS only; HSTS at the proxy
- [ ] Database backups enabled
- [ ] `TOKEN_ENCRYPTION_KEY` and the OAuth secret live in a secret manager, not in the image
- [ ] `ALLOWED_EXTENSION_IDS` set
- [ ] Logs shipped somewhere (JSON lines on stdout/stderr; secrets are redacted)
