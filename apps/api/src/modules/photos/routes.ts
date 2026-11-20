import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authOf } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import * as svc from './service.js';

const body = z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(100).max(2_200_000) });

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  app.post('/animals/:id/photos/upload', { preHandler: [authenticate, idempotent], bodyLimit: 3_000_000 }, async (req, reply) => {
    const b = body.parse(req.body);
    return reply.code(201).send(await svc.uploadPhoto(app.db, authOf(req), z.object({ id: z.string().uuid() }).parse(req.params).id, b.contentType, b.data));
  });
  app.get('/photos/:photoId/file', async (req, reply) => {
    const f = await svc.photoFile(app.db, z.object({ photoId: z.string().uuid() }).parse(req.params).photoId);
    return reply.header('content-type', f.contentType).header('cache-control', 'public, max-age=31536000, immutable').header('cross-origin-resource-policy', 'cross-origin').send(f.data);
  });
}
