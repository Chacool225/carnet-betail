import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authOf, requireRole } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import { idParam, lookupQuery } from '../animals/schemas.js';
import * as svc from './service.js';

const inviteBody = z.object({ vetId: z.string().uuid() });
const revokeParams = z.object({ id: z.string().uuid(), vetId: z.string().uuid() });

export async function accessRoutes(app: FastifyInstance): Promise<void> {
  app.post('/access/scan', { preHandler: [authenticate, requireRole('vet'), idempotent] }, async (req) =>
    svc.scan(app.db, authOf(req), lookupQuery.parse(req.body)),
  );

  app.get('/access', { preHandler: [authenticate, requireRole('vet')] }, async (req) => svc.listMine(app.db, authOf(req)));

  app.get('/animals/:id/access', { preHandler: [authenticate] }, async (req) =>
    svc.listForAnimal(app.db, authOf(req), idParam.parse(req.params).id),
  );

  app.post('/animals/:id/access', { preHandler: [authenticate, requireRole('eleveur'), idempotent] }, async (req, reply) =>
    reply.code(201).send(await svc.invite(app.db, authOf(req), idParam.parse(req.params).id, inviteBody.parse(req.body).vetId)),
  );

  app.delete('/animals/:id/access/:vetId', { preHandler: [authenticate, requireRole('eleveur'), idempotent] }, async (req, reply) => {
    const p = revokeParams.parse(req.params);
    await svc.revoke(app.db, authOf(req), p.id, p.vetId);
    return reply.code(204).send();
  });
}
