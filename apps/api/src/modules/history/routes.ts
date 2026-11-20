import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import * as svc from './service.js';
import { archiveParams, historyQuery } from './schemas.js';

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  const pre = { preHandler: [authenticate] };
  const heavy = app.config.rateLimitEnabled ? { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } } : {};

  app.get('/me/history', pre, async (req) => svc.myHistory(app.db, authOf(req), historyQuery.parse(req.query)));

  app.get('/export/history.csv', { ...pre, ...heavy }, async (req, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="historique.csv"')
      .send(await svc.exportHistoryCsv(app.db, authOf(req), historyQuery.parse(req.query))),
  );

  app.get('/animals/:id/archive', pre, async (req) => svc.archive(app.db, authOf(req), archiveParams.parse(req.params).id));
}
