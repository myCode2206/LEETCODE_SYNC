import { Migrator } from 'kysely/migration';
import type { Kysely } from 'kysely';
import type { MigrationProvider } from 'kysely/migration';
import { migrations } from './migrations/index.js';
import type { Database } from './schema.js';

const provider: MigrationProvider = { getMigrations: async () => migrations };

export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
