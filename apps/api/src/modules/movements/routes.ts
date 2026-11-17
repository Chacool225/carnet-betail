import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import { idParam } from '../animals/schemas.js';
import * as svc from './service.js';
import { listingBody, marketQuery, recoveryBody, sellBody, slaughterBody, theftBody, transferBody } from './schemas.js';

export async function movementRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate] };
  const write = { preHandler: [authenticate, idempotent] };
  const id = (req: { params: unknown }) => idParam.parse(req.params).id;

  app.get('/animals/:id/flows', read, async (req) => svc.listFlows(app.db, authOf(req), id(req)));
  app.post('/animals/:id/sale', write, async (req, reply) => reply.code(201).send(await svc.sell(app.db, authOf(req), id(req), sellBody.parse(req.body))));
  app.post('/animals/:id/slaughter', write, async (req, reply) => reply.code(201).send(await svc.slaughter(app.db, authOf(req), id(req), slaughterBody.parse(req.body))));
  app.post('/animals/:id/transfer', write, async (req, reply) => reply.code(201).send(await svc.transfer(app.db, authOf(req), id(req), transferBody.parse(req.body))));
  app.post('/animals/:id/theft', write, async (req, reply) => reply.code(201).send(await svc.declareTheft(app.db, authOf(req), id(req), theftBody.parse(req.body ?? {}))));
  app.post('/animals/:id/recovery', write, async (req) => svc.declareRecovery(app.db, authOf(req), id(req), recoveryBody.parse(req.body ?? {}).note));

  app.post('/animals/:id/listing', write, async (req, reply) => reply.code(201).send(await svc.putOnMarket(app.db, authOf(req), id(req), listingBody.parse(req.body).price)));
  app.delete('/animals/:id/listing', write, async (req, reply) => {
    await svc.removeFromMarket(app.db, authOf(req), id(req));
    return reply.code(204).send();
  });
  app.get('/market', read, async (req) => svc.market(app.db, marketQuery.parse(req.query)));
}
