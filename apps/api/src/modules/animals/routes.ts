import type { FastifyInstance } from 'fastify';
import { authenticate, authOf, requireRole } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import * as svc from './service.js';
import { createAnimalBody, idParam, listQuery, lookupQuery, photoBody, photoParams, updateAnimalBody } from './schemas.js';

export async function animalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/animals', { preHandler: [authenticate] }, async (req) => svc.listAnimals(app.db, authOf(req), listQuery.parse(req.query)));

  // Déclarée avant /animals/:id : « lookup » n'est pas un identifiant.
  app.get('/animals/lookup', { preHandler: [authenticate] }, async (req) => svc.lookup(app.db, authOf(req), lookupQuery.parse(req.query)));

  app.get('/animals/:id', { preHandler: [authenticate] }, async (req) => svc.getAnimal(app.db, authOf(req), idParam.parse(req.params).id));

  app.post('/animals', { preHandler: [authenticate, requireRole('eleveur'), idempotent] }, async (req, reply) =>
    reply.code(201).send(await svc.createAnimal(app.db, authOf(req), createAnimalBody.parse(req.body))),
  );

  app.patch('/animals/:id', { preHandler: [authenticate, idempotent] }, async (req) =>
    svc.updateAnimal(app.db, authOf(req), idParam.parse(req.params).id, updateAnimalBody.parse(req.body)),
  );

  app.post('/animals/:id/photos', { preHandler: [authenticate, idempotent] }, async (req, reply) =>
    reply.code(201).send(await svc.addPhoto(app.db, authOf(req), idParam.parse(req.params).id, photoBody.parse(req.body).url)),
  );

  app.delete('/animals/:id/photos/:photoId', { preHandler: [authenticate, idempotent] }, async (req, reply) => {
    const p = photoParams.parse(req.params);
    await svc.removePhoto(app.db, authOf(req), p.id, p.photoId);
    return reply.code(204).send();
  });
}
