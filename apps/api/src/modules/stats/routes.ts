import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import * as svc from './service.js';
import { healthQuery } from './service.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  const pre = { preHandler: [authenticate] };
  const heavy = app.config.rateLimitEnabled ? { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } } : {};
  const csv = (name: string, body: string, reply: any) =>
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send(body);

  app.get('/stats/overview', pre, async (req) => svc.overview(app.db, authOf(req)));
  app.get('/stats/zones', pre, async (req) => svc.zones(app.db, authOf(req)));

  app.get('/stats/health-map', pre, async (req) => svc.healthMap(app.db, authOf(req), healthQuery.parse(req.query)));
  app.get('/stats/cases-timeline', pre, async (req) => svc.casesTimeline(app.db, authOf(req), healthQuery.parse(req.query)));

  app.get('/export/animals.csv', { ...pre, ...heavy }, async (req, reply) => csv('animaux.csv', await svc.exportAnimalsCsv(app.db, authOf(req)), reply));
  app.get('/export/cases.csv', { ...pre, ...heavy }, async (req, reply) => csv('signalements.csv', await svc.exportCasesCsv(app.db, authOf(req)), reply));
}
