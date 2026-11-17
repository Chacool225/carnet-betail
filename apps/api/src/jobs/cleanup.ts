import type { Db } from '../db/index.js';

export interface CleanupResult {
  idempotencyKeys: number;
  refreshTokens: number;
  clientOps: number;
}

const count = async (db: Db, sql: string): Promise<number> =>
  (await db.query<{ n: number }>(`WITH d AS (${sql} RETURNING 1) SELECT count(*)::int AS n FROM d`))[0]!.n;

/**
 * Ménage périodique des tables techniques (jamais de l'historique métier) :
 * - clés d'idempotence : terminées depuis plus de 48 h, ou restées « en cours » plus de 10 minutes (requête interrompue) ;
 * - jetons de renouvellement : expirés depuis plus de 7 jours, ou révoqués depuis plus de 30 jours ;
 * - opérations de synchronisation : plus de 90 jours.
 */
export async function cleanup(db: Db): Promise<CleanupResult> {
  return {
    idempotencyKeys: await count(db, `DELETE FROM idempotency_keys WHERE (status IS NOT NULL AND created_at < now() - interval '48 hours') OR (status IS NULL AND created_at < now() - interval '10 minutes')`),
    refreshTokens: await count(db, `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '30 days'`),
    clientOps: await count(db, `DELETE FROM client_ops WHERE created_at < now() - interval '90 days'`),
  };
}

/** Lance le ménage toutes les heures ; renvoie la fonction d'arrêt. */
export function scheduleCleanup(db: Db, log: (msg: string) => void, everyMs = 3_600_000): () => void {
  const timer = setInterval(() => {
    cleanup(db).then((r) => log(`ménage : ${JSON.stringify(r)}`)).catch((e) => log(`ménage en échec : ${String(e)}`));
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
