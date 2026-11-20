import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import * as svc from './service.js';
import { completeBody, idParam, messageBody, noteBody, proposalBody, requestBody, requestsQuery } from './schemas.js';

export async function purchaseRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate] };
  const write = { preHandler: [authenticate, idempotent] };
  const id = (req: { params: unknown }) => idParam.parse(req.params).id;

  app.get('/market/:id', read, async (req) => svc.publicSheet(app.db, authOf(req), id(req)));
  app.post('/market/:id/requests', write, async (req, reply) => reply.code(201).send(await svc.createRequest(app.db, authOf(req), id(req), requestBody.parse(req.body ?? {}))));
  app.get('/me/purchase-requests', read, async (req) => svc.listSent(app.db, authOf(req), requestsQuery.parse(req.query)));
  app.get('/purchase-requests', read, async (req) => svc.listReceived(app.db, authOf(req), requestsQuery.parse(req.query)));
  app.get('/purchase-requests/:id', read, async (req) => svc.detail(app.db, authOf(req), id(req)));
  app.get('/purchase-requests/:id/messages', read, async (req) => svc.listMessages(app.db, authOf(req), id(req)));
  app.post('/purchase-requests/:id/messages', write, async (req, reply) => reply.code(201).send(await svc.postMessage(app.db, authOf(req), id(req), messageBody.parse(req.body).body)));
  app.post('/purchase-requests/:id/proposal', write, async (req) => svc.propose(app.db, authOf(req), id(req), proposalBody.parse(req.body)));
  app.post('/purchase-requests/:id/accept', write, async (req) => svc.decide(app.db, authOf(req), id(req), 'accept', noteBody.parse(req.body ?? {}).note));
  app.post('/purchase-requests/:id/refuse', write, async (req) => svc.decide(app.db, authOf(req), id(req), 'refuse', noteBody.parse(req.body ?? {}).note));
  app.post('/purchase-requests/:id/cancel', write, async (req) => svc.cancel(app.db, authOf(req), id(req)));
  app.post('/purchase-requests/:id/complete', write, async (req) => svc.complete(app.db, authOf(req), id(req), completeBody.parse(req.body ?? {}).occurredOn));
}
