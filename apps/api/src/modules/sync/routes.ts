import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import { batchBody, pull, pullQuery, runBatch } from './service.js';

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  const limit = app.config.rateLimitEnabled ? { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } } : {};

  /** Envoi groupé des écritures faites hors-ligne. Toujours 200 : le détail de chaque opération est dans `results`. */
  app.post('/sync', { preHandler: [authenticate], ...limit }, async (req) => runBatch(app.db, authOf(req), batchBody.parse(req.body).ops));

  app.get('/sync/pull', { preHandler: [authenticate], ...limit }, async (req) => pull(app.db, authOf(req), pullQuery.parse(req.query).since));
}
