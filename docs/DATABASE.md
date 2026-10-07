# Database

PostgreSQL. The schema is in
[`backend/src/database/migrations/0001_initial.ts`](../backend/src/database/migrations/0001_initial.ts)
and the matching Kysely types are in
[`backend/src/database/schema.ts`](../backend/src/database/schema.ts). Migrations run on
startup; to run them by hand, use `npm run migrate -w @lcsync/backend`.

```
users ─1:1─ github_accounts          (keyed by GitHub numeric id → username changes are harmless)
  │
  ├─1:N─ sessions                    (token hash only)
  ├─1:N─ repositories                (one row per repo+branch+root; one active per user)
  ├─1:N─ custom_tags
  ├─1:N─ sync_jobs                   UNIQUE (user_id, idempotency_key)
  └─1:N─ user_problems ─N:1─ problems ─N:M─ topics        (problem_topics; LeetCode catalog, global)
            │
            ├─N:M─ patterns          (user_problem_patterns)
            ├─N:M─ custom_tags       (user_problem_tags)
            ├─1:N─ solutions         UNIQUE (user_problem_id, language)
            ├─1:N─ submissions       UNIQUE (user_id, leetcode_submission_id)
            └─1:N─ revisions
```

| Table                                    | Purpose                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `problems`                               | Global LeetCode catalog keyed by internal `question_id` (stable across title changes). `directory_name` is assigned once and never changes                                |
| `topics`, `problem_topics`               | Official LeetCode topics. Never edited by users                                                                                                                           |
| `user_problems`                          | Per-user progress: status, notes, user-provided complexity, attempt/accepted/WA/TLE/MLE/RE/CE counters, revision count, first/last solved, last revised, `metadata_dirty` |
| `patterns`, `user_problem_patterns`      | DSA patterns. Names are global; assignment is per user                                                                                                                    |
| `custom_tags`, `user_problem_tags`       | User tags such as "Google" or "Must Revise"                                                                                                                               |
| `solutions`                              | Current code per (problem, language), plus sync state: `synced_code_hash` and `synced_repository_id`                                                                      |
| `submissions`                            | Every attempt. Code is stored for accepted submissions only. Saved attempts record their repository path                                                                  |
| `revisions`                              | Event log: `first_solve`, `resolve`, `manual`, `status_change`                                                                                                            |
| `sync_jobs`                              | Idempotency and history: one row per key, with status, outcome, commit and error                                                                                          |
| `oauth_states`, `auth_codes`, `sessions` | Auth hand-off; only hashes are stored                                                                                                                                     |

## Invariants

- One `problems` row per LeetCode question, so there is one directory per problem.
- One `solutions` row per (user problem, language), so there is one file per language.
- One `submissions` row per LeetCode submission ID, so counters can't be incremented twice.
- A solution is "dirty" for the active repository when
  `synced_repository_id ≠ active.id OR synced_code_hash ≠ code_hash`. Dirty problems are
  included in the next commit.
