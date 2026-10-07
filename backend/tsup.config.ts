import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/database/migrate-cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Shared workspace package is TypeScript source: bundle it.
  noExternal: ['@lcsync/shared'],
  // Dev-only embedded Postgres; never needed in production.
  external: ['@electric-sql/pglite'],
});
