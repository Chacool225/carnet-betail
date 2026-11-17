import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import { getMe, updateMe } from '../auth/service.js';
import { updateMeBody } from '../auth/schemas.js';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: [authenticate] }, async (req) => getMe(app.db, authOf(req).userId));

  app.patch('/me', { preHandler: [authenticate, idempotent] }, async (req) =>
    updateMe(app.db, authOf(req).userId, updateMeBody.parse(req.body)),
  );
}
