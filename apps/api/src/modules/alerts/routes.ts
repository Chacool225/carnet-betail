import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authOf, requireRole } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import * as svc from './service.js';

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get('/alerts', { preHandler: [authenticate] }, async (req) => svc.listAlerts(app.db, authOf(req), svc.alertsQuery.parse(req.query)));

  app.patch('/alerts/:id/handle', { preHandler: [authenticate, requireRole('agent', 'autorite'), idempotent] }, async (req) =>
    svc.handleAlert(app.db, authOf(req), z.object({ id: z.string().uuid() }).parse(req.params).id),
  );

  app.get('/agent/overview', { preHandler: [authenticate, requireRole('agent')] }, async (req) => svc.agentOverview(app.db, authOf(req)));
}
