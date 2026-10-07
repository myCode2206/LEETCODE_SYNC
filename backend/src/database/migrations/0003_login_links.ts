import { sql } from 'kysely';
import type { Kysely } from 'kysely';

/** Sign-in links that can be opened in another browser or profile than the extension's. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE login_links (
    link_hash text PRIMARY KEY,
    poll_hash text NOT NULL UNIQUE,
    access_level text NOT NULL CHECK (access_level IN ('public', 'private')),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS login_links`.execute(db);
}
