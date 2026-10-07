import { loadDatabaseUrl } from './database-url.js';
import { createDatabase } from './connection.js';
import { migrateToLatest } from './migrator.js';

const db = await createDatabase(loadDatabaseUrl());
try {
  const applied = await migrateToLatest(db);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await db.destroy();
}
