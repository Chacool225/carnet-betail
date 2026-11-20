import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import * as svc from './service.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audit', { preHandler: [authenticate] }, async (req) => svc.listAudit(app.db, authOf(req), svc.auditQuery.parse(req.query)));
}
