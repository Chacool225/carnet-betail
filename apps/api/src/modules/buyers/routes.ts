import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import { buyerProfileBody } from './schemas.js';
import { getBuyerProfile, putBuyerProfile } from './service.js';

export async function buyerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/buyer-profile', { preHandler: [authenticate] }, async (req) => ({ profile: await getBuyerProfile(app.db, authOf(req).userId) }));
  app.put('/me/buyer-profile', { preHandler: [authenticate, idempotent] }, async (req) => ({ profile: await putBuyerProfile(app.db, authOf(req), buyerProfileBody.parse(req.body ?? {})) }));
}
