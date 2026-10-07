import { createApp } from './app.js';
import { createLogger } from './common/logger.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { createDatabase } from './database/connection.js';
import { migrateToLatest } from './database/migrator.js';

const config = loadConfig();
const logger = createLogger(config.logLevel, { service: 'lcsync-backend' });
const db = await createDatabase(config.databaseUrl);

const applied = await migrateToLatest(db);
if (applied.length) logger.info('migrations applied', { applied });

const container = createContainer(config, db, logger);
const app = createApp(container, {
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || true : false,
});

const server = app.listen(config.port, () => {
  logger.info('listening', { port: config.port, env: config.env });
});

async function shutdown(signal: string) {
  logger.info('shutting down', { signal });
  server.close();
  await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
