import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError, invalid } from '../lib/errors.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Rejeu sûr des écritures. Le client envoie `Idempotency-Key: <uuid>` ; si la même requête arrive deux fois
 * (coupure réseau, synchronisation hors-ligne), la seconde reçoit la réponse de la première sans rien refaire.
 * - même clé, requête différente → 422 idempotency_key_reuse
 * - même clé, première requête encore en cours → 409 request_in_progress
 * - seules les réponses 2xx sont mémorisées ; un échec libère la clé pour un nouvel essai.
 * À placer après `authenticate` (la clé est propre à chaque utilisateur).
 */
export const idempotent: preHandlerAsyncHookHandler = async function (this: FastifyInstance, req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['idempotency-key'];
  if (key === undefined || !MUTATING.has(req.method) || !req.auth) return;
  if (typeof key !== 'string' || key.length < 8 || key.length > 100) {
    throw invalid("L'en-tête Idempotency-Key doit faire entre 8 et 100 caractères.");
  }
  const userId = req.auth.userId;
  const path = req.url.split('?')[0]!;
  const hash = createHash('sha256').update(`${req.method}\n${req.url}\n${JSON.stringify(req.body ?? null)}`).digest('hex');

  const inserted = await this.db.query(
    `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
    [userId, key, req.method, path, hash],
  );
  if (inserted.length) {
    req.idem = { userId, key };
    return;
  }
  const existing = (await this.db.query('SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]))[0];
  if (!existing) {
    // supprimée entre-temps (première requête échouée) : le client peut simplement réessayer
    throw new AppError(409, 'request_in_progress', 'Une requête identique est en cours. Réessayez.');
  }
  if (existing.request_hash !== hash) {
    throw invalid('Cette clé Idempotency-Key a déjà servi pour une requête différente.', undefined, 'idempotency_key_reuse');
  }
  if (existing.status == null) {
    throw new AppError(409, 'request_in_progress', 'Une requête identique est en cours. Réessayez dans un instant.');
  }
  reply.header('idempotency-replayed', 'true').code(existing.status);
  if (existing.body == null) return reply.send();
  return reply.send(existing.body);
};

/** Hook global : mémorise la réponse (2xx) ou libère la clé (autres statuts). */
export function registerIdempotencyHook(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    const idem = req.idem;
    if (!idem) return payload;
    req.idem = null;
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      let body: string | null = null;
      if (typeof payload === 'string' && payload.length) {
        try {
          JSON.parse(payload);
          body = payload;
        } catch {
          body = null;
        }
      }
      await app.db.query('UPDATE idempotency_keys SET status = $3, body = $4::jsonb WHERE user_id = $1 AND key = $2', [
        idem.userId,
        idem.key,
        reply.statusCode,
        body,
      ]);
    } else {
      await app.db.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [idem.userId, idem.key]);
    }
    return payload;
  });
}
