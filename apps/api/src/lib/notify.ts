import type { Queryable } from '../db/index.js';

/**
 * Crée une notification dans l'application. À appeler dans la même transaction que l'action.
 * `dedupeKey` évite d'envoyer deux fois la même notification (rappels, par exemple).
 * L'envoi par SMS ou WhatsApp n'est pas inclus : il demande un compte chez un fournisseur.
 */
export async function notify(
  q: Queryable,
  n: { userId: string; kind: string; title: string; body?: string | null; link?: string | null; dedupeKey?: string | null },
): Promise<void> {
  await q.query(
    `INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [n.userId, n.kind, n.title, n.body ?? null, n.link ?? null, n.dedupeKey ?? null],
  );
}
