import { sql } from 'kysely';
import type { Kysely } from 'kysely';

/** Problem statement (LeetCode HTML), shown in each problem README when enabled. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE problems ADD COLUMN content text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE problems DROP COLUMN content`.execute(db);
}
