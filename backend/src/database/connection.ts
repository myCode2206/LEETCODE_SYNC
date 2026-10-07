import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

// Return BIGINT/COUNT as JS numbers (GitHub ids and counts are far below 2^53).
pg.types.setTypeParser(20, (value) => Number(value));

export async function createDatabase(databaseUrl: string): Promise<Kysely<Database>> {
  if (databaseUrl.startsWith('pglite://')) {
    // Embedded Postgres for local development without a database server.
    const { createPgliteDialect } = await import('./pglite-dialect.js');
    const dataDir = databaseUrl.slice('pglite://'.length) || undefined;
    return new Kysely<Database>({ dialect: await createPgliteDialect(dataDir) });
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
