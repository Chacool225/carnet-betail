import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
/** Dossier des migrations : apps/api/migrations (depuis src/db ou dist/db). */
export const MIGRATIONS_DIR = join(here, '..', '..', 'migrations');

/**
 * Applique, dans l'ordre alphabétique, les fichiers `NNN_nom.sql` pas encore appliqués.
 * Chaque fichier est exécuté avec l'écriture de son suivi dans une même exécution
 * (PostgreSQL traite un envoi multi-instructions comme une seule transaction).
 */
export async function migrate(db: Db, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await db.exec(`${sql}\n;\nINSERT INTO schema_migrations (name) VALUES ('${f}');`);
    applied.push(f);
  }
  return applied;
}
