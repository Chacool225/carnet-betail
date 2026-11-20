import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { MIGRATIONS_DIR, migrate } from './db/migrate.js';
import { scheduleCleanup } from './jobs/cleanup.js';
import { scheduleReminders } from './jobs/reminders.js';

const config = loadConfig();
const db = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
const applied = await migrate(db, MIGRATIONS_DIR);
if (applied.length) console.log(`Migrations appliquées : ${applied.join(', ')}`);

const app = await buildApp({ config, db, logger: true });

const stopCleanup = scheduleCleanup(db, (m) => app.log.info(m));
const stopReminders = scheduleReminders(db, (m) => app.log.info(m));

const stop = async (signal: string) => {
  app.log.info(`${signal} reçu, arrêt en cours`);
  stopCleanup();
  stopReminders();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
