import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authOf } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import { idParam } from '../animals/schemas.js';
import * as svc from './service.js';
import { caseParam, createCaseBody, createEventBody, mortalityBody, remindersQuery, updateCaseBody } from './schemas.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate] };
  const write = { preHandler: [authenticate, idempotent] };

  app.get('/animals/:id/health-events', read, async (req) =>
    svc.listEvents(app.db, authOf(req), idParam.parse(req.params).id, z.object({ type: z.enum(['vaccin', 'soin', 'controle']).optional() }).parse(req.query).type),
  );
  app.post('/animals/:id/health-events', write, async (req, reply) =>
    reply.code(201).send(await svc.createEvent(app.db, authOf(req), idParam.parse(req.params).id, createEventBody.parse(req.body))),
  );
  app.get('/animals/:id/health-summary', read, async (req) => svc.healthSummary(app.db, authOf(req), idParam.parse(req.params).id));

  app.get('/reminders', read, async (req) => svc.reminders(app.db, authOf(req), remindersQuery.parse(req.query).days));

  app.post('/animals/:id/mortality', write, async (req, reply) =>
    reply.code(201).send(await svc.declareMortality(app.db, authOf(req), idParam.parse(req.params).id, mortalityBody.parse(req.body))),
  );

  app.get('/animals/:id/cases', read, async (req) => svc.listCases(app.db, authOf(req), idParam.parse(req.params).id));
  app.post('/animals/:id/cases', write, async (req, reply) =>
    reply.code(201).send(await svc.createCase(app.db, authOf(req), idParam.parse(req.params).id, createCaseBody.parse(req.body))),
  );
  app.patch('/cases/:caseId', write, async (req) => svc.updateCase(app.db, authOf(req), caseParam.parse(req.params).caseId, updateCaseBody.parse(req.body)));
}
