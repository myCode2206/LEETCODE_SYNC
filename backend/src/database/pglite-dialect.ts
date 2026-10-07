/**
 * Kysely dialect backed by PGlite (Postgres compiled to WASM). Used by the test suite and for
 * Postgres-free local development (DATABASE_URL=pglite://...). PGlite is a single session, so
 * connections are handed out one at a time to keep transactions isolated.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PostgresDialect } from 'kysely';
import type { PostgresPool, PostgresPoolClient, PostgresQueryResult } from 'kysely';

const AFFECTING = /^\s*(insert|update|delete|merge)\b/i;

export async function createPgliteDialect(dataDir?: string): Promise<PostgresDialect> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  // PGlite creates the data directory itself but not its parents (e.g. ".data/").
  if (dataDir) await mkdir(dirname(dataDir), { recursive: true });
  const pglite = await PGlite.create(dataDir, {
    parsers: { [types.INT8]: (value: string) => Number(value) },
  });

  let queue: Promise<void> = Promise.resolve();

  const pool: PostgresPool = {
    options: {},
    async connect(): Promise<PostgresPoolClient> {
      let release!: () => void;
      const acquired = queue;
      queue = queue.then(() => new Promise<void>((resolve) => (release = resolve)));
      await acquired;
      const client = {
        async query<R>(
          sqlText: string,
          parameters: ReadonlyArray<unknown>,
        ): Promise<PostgresQueryResult<R>> {
          const result = await pglite.query<R>(sqlText, parameters as unknown[]);
          const match = AFFECTING.exec(sqlText);
          return {
            command: (match?.[1]?.toUpperCase() ?? 'SELECT') as PostgresQueryResult<R>['command'],
            rowCount: result.affectedRows ?? result.rows.length,
            rows: result.rows,
          };
        },
        release() {
          release();
        },
      };
      return client as unknown as PostgresPoolClient;
    },
    async end() {
      await pglite.close();
    },
  };

  return new PostgresDialect({ pool });
}
