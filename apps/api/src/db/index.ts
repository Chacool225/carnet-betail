/**
 * Couche d'accès à PostgreSQL.
 * - en production et avec Docker : `pg` (DATABASE_URL renseignée) ;
 * - sans Docker (développement, tests) : PGlite, un vrai PostgreSQL compilé en WebAssembly.
 * Les deux exposent la même interface, avec des requêtes SQL paramétrées ($1, $2, ...).
 */
export type Row = Record<string, any>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  readonly kind: 'pg' | 'pglite';
  /** Exécute plusieurs instructions SQL sans paramètre (migrations). */
  exec(sql: string): Promise<void>;
  /** Exécute `fn` dans une transaction ; annulée si `fn` lève une erreur. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const DATE_OID = 1082;

export interface DbOptions {
  databaseUrl?: string;
  /** Dossier de PGlite. `memory://` (ou vide) = en mémoire. */
  pgliteDir?: string;
}

export async function createDb(opts: DbOptions): Promise<Db> {
  if (opts.databaseUrl) return createPgDb(opts.databaseUrl);
  return createPgliteDb(opts.pgliteDir);
}

async function createPgDb(url: string): Promise<Db> {
  const pg = (await import('pg')).default;
  // Les colonnes DATE restent des chaînes AAAA-MM-JJ (pas de décalage de fuseau).
  pg.types.setTypeParser(DATE_OID, (v: string) => v);
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    kind: 'pg',
    async query<T extends Row = Row>(sql: string, params?: unknown[]) {
      const r = await pool.query(sql, params as any[]);
      return r.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({
          async query<R extends Row = Row>(sql: string, params?: unknown[]) {
            const r = await client.query(sql, params as any[]);
            return r.rows as R[];
          },
        });
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* la connexion est peut-être déjà perdue */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPgliteDb(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const inMemory = !dir || dir === 'memory://';
  if (!inMemory) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir!, { recursive: true });
  }
  const pg: any = new (PGlite as any)({
    ...(inMemory ? {} : { dataDir: dir }),
    parsers: { [DATE_OID]: (v: string) => v },
  });
  await pg.waitReady;
  return {
    kind: 'pglite',
    async query<T extends Row = Row>(sql: string, params?: unknown[]) {
      const r = await pg.query(sql, params ?? []);
      return r.rows as T[];
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      return pg.transaction(async (t: any) =>
        fn({
          async query<R extends Row = Row>(sql: string, params?: unknown[]) {
            const r = await t.query(sql, params ?? []);
            return r.rows as R[];
          },
        }),
      );
    },
    async close() {
      await pg.close();
    },
  };
}
