import { loadConfig } from '../config.js';
import { createDb } from '../db/index.js';
import { MIGRATIONS_DIR, migrate } from '../db/migrate.js';

const config = loadConfig();
const db = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
const applied = await migrate(db, MIGRATIONS_DIR);
console.log(applied.length ? `Appliquées : ${applied.join(', ')}` : 'Base déjà à jour.');
await db.close();
