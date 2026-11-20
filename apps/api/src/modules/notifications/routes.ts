import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authOf } from '../../plugins/auth.js';
import * as svc from './service.js';

const query = z.object({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate] };
  app.get('/me/notifications', read, async (req) => svc.listNotifications(app.db, authOf(req), query.parse(req.query)));
  app.post('/me/notifications/read-all', read, async (req) => ({ marked: await svc.markAllRead(app.db, authOf(req)) }));
  app.post('/me/notifications/:id/read', read, async (req, reply) => {
    await svc.markRead(app.db, authOf(req), z.object({ id: z.string().uuid() }).parse(req.params).id);
    return reply.code(204).send();
  });
}
