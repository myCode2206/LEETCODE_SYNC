import type { Kysely } from 'kysely';
import { createDatabase } from '../../src/database/connection.js';
import { migrateToLatest } from '../../src/database/migrator.js';
import type { Database } from '../../src/database/schema.js';

/** Fresh in-memory Postgres (PGlite) with all migrations applied. */
export async function createTestDatabase(): Promise<Kysely<Database>> {
  const db = await createDatabase('pglite://');
  await migrateToLatest(db);
  return db;
}
