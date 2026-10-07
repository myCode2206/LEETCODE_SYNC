# API reference (`/api/v1`)

Request and response types live in [`packages/shared/src/api.ts`](../packages/shared/src/api.ts).
Request schemas are the zod objects the server validates against.

**Authentication:** every endpoint except `/auth/github*`, `/auth/token` and `/health`
requires `Authorization: Bearer <sessionToken>`.

**Errors:** every non-2xx response has this shape:

```json
{
  "error": {
    "code": "GITHUB_AUTH_EXPIRED",
    "message": "GitHub authorization has expired. Please reconnect GitHub.",
    "retryable": false,
    "retryAt": "…optional"
  }
}
```

| Code                                     | HTTP    | Meaning / client action                             |
| ---------------------------------------- | ------- | --------------------------------------------------- |
| `UNAUTHENTICATED`                        | 401     | Session missing/expired: sign in again              |
| `VALIDATION_FAILED`                      | 400     | Fix the request (`details` lists the issues)        |
| `NOT_FOUND`                              | 404     |                                                     |
| `CONFLICT`                               | 409     | e.g. repository name taken                          |
| `SYNC_IN_PROGRESS`                       | 409     | Same idempotency key is running: retry later        |
| `REPOSITORY_NOT_CONFIGURED`              | 412     | Choose a repository                                 |
| `INVALID_REPOSITORY_CONFIG`              | 400     | Bad root dir / branch for an empty repo             |
| `GITHUB_NOT_CONNECTED`                   | 412     | Connect GitHub                                      |
| `GITHUB_AUTH_EXPIRED`                    | 401     | Reconnect GitHub                                    |
| `GITHUB_PERMISSION_DENIED`               | 403     | No write access / private repo without `repo` scope |
| `GITHUB_REPO_NOT_FOUND`                  | 404     | Deleted, renamed beyond reach, or private           |
| `GITHUB_BRANCH_NOT_FOUND`                | 404     | Choose another branch                               |
| `GITHUB_RATE_LIMITED`                    | 429     | Retry after `retryAt` (also `Retry-After` header)   |
| `GITHUB_UNAVAILABLE` / `GITHUB_CONFLICT` | 503/409 | Transient: retry with backoff                       |
| `RATE_LIMITED`                           | 429     | Too many requests to this API                       |
| `INTERNAL`                               | 500     | Retry                                               |

## Auth

| Method & path                                           | Description                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/github?redirect_uri=&access=public\|private` | Starts OAuth; 302 to GitHub                                                                                                       |
| `GET /auth/github/check?redirect_uri=&access=`          | Pre-flight: 204 if the server would accept this sign-in, else 400 (no side effects)                                               |
| `GET /auth/github/callback`                             | GitHub redirect target; 302 to the extension with `?code=` or `?error=` (sign-in links: a result page instead)                    |
| `POST /auth/github/link` `{access}`                     | Creates a sign-in link usable in any browser → `LoginLinkDto` `{url, code, pollToken, expiresAt}` (15 min). Extension origin only |
| `GET /auth/github/link/:token`                          | Page showing the confirmation `code`, with a button to continue to GitHub                                                         |
| `GET /auth/github/link/:token/continue`                 | Starts OAuth for the link; 302 to GitHub                                                                                          |
| `POST /auth/github/link/poll` `{pollToken}`             | `{status: "pending"}` or, once approved and only once, `{status: "complete", session}`; 401 when expired or used                  |
| `POST /auth/token` `{code}`                             | Exchanges the one-time code for a session → `SessionDto`                                                                          |
| `GET /auth/me`                                          | `MeDto` (GitHub account + active repository)                                                                                      |
| `POST /auth/logout`                                     | Ends this session (204)                                                                                                           |
| `DELETE /auth/github`                                   | Revokes the GitHub grant, deletes the token, ends all sessions (204)                                                              |

## GitHub & repository

| Method & path                                                   | Description                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /github/repositories`                                      | `{items: GitHubRepoDto[]}` (with `canPush`)                                                              |
| `POST /github/repositories` `{name, private, description?}`     | Create (auto-initialized) → 201 `GitHubRepoDto`                                                          |
| `GET /github/repositories/:id/branches`                         | `{items: BranchDto[]}`                                                                                   |
| `GET /repository`                                               | `{repository: RepositoryConfigDto \| null}`                                                              |
| `PUT /repository` `{githubRepoId, branch, rootDir?, settings?}` | Validates access and branch, then activates. Changing repo, branch or root marks everything for backfill |
| `PATCH /repository/settings` `Partial<RepositorySettings>`      | Update generation/commit settings                                                                        |

## Sync

| Method & path                             | Description                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /sync/problem` `SyncProblemRequest` | Record a submission and publish it. 201 when new; 200 with `duplicate: true` when the idempotency key was already processed |
| `POST /sync/pending`                      | Push every problem not yet on the active repository in one commit                                                           |
| `POST /sync/full`                         | Regenerate every managed file in one commit (repair/settings change)                                                        |
| `GET /sync/jobs?limit=`                   | Recent `SyncJobDto`s                                                                                                        |

`SyncResultDto.outcome`:

- `committed`: a commit was created.
- `up_to_date`: the files already matched the branch.
- `recorded`: saved to the database only. This happens for identical code, failed
  submissions, commits turned off, or no repository configured.

Example request:

```json
{
  "idempotencyKey": "submission:1234567890",
  "problem": {
    "questionId": "1",
    "frontendId": "1",
    "title": "Two Sum",
    "titleSlug": "two-sum",
    "difficulty": "Easy",
    "topics": [{ "name": "Array", "slug": "array" }]
  },
  "submission": {
    "leetcodeSubmissionId": "1234567890",
    "status": "accepted",
    "language": "python3",
    "code": "class Solution: ...",
    "runtime": "3 ms",
    "memory": "17.9 MB",
    "runtimeMs": 3,
    "submittedAt": "2026-10-07T10:00:00Z"
  },
  "options": { "commit": true }
}
```

## Problems, revisions, stats

| Method & path                                                                                          | Description                                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /problems?q=&topic=&pattern=&tag=&difficulty=&language=&status=&due=`                             | Solved problems (`ProblemSummaryDto[]`), sorted by number. `q` matches number, title, topic, pattern, tag, language and difficulty |
| `GET /problems/:slug`                                                                                  | `ProblemDetailDto` with solutions, the last 50 submissions, and revisions                                                          |
| `PATCH /problems/:slug` `{patterns?, customTags?, status?, notes?, timeComplexity?, spaceComplexity?}` | Saves, then publishes → `{problem, sync, syncError}`. Official topics can't be changed                                             |
| `POST /problems/:slug/attempts` `{leetcodeSubmissionId, kind, note?}`                                  | Saves an accepted submission under `attempts/` and commits it                                                                      |
| `POST /revisions` `{problemSlug, notes?, status?}`                                                     | Manual revision → `{problem, sync, syncError}`                                                                                     |
| `GET /revisions/due`                                                                                   | Problems due for revision, sorted by due date                                                                                      |
| `GET /stats`                                                                                           | `StatsDto` (totals, top topics/patterns/languages/tags, due and pending counts, recent syncs)                                      |
| `GET /topics`, `/patterns`, `/tags`                                                                    | `{items: CategoryCountDto[]}`                                                                                                      |
