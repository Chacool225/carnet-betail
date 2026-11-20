import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { registerContext } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import { registerIdempotencyHook } from './plugins/idempotency.js';
import { authRoutes } from './modules/auth/routes.js';
import { historyRoutes } from './modules/history/routes.js';
import { meRoutes } from './modules/me/routes.js';
import { zoneRoutes } from './modules/zones/routes.js';
import { vetRoutes } from './modules/vets/routes.js';
import { animalRoutes } from './modules/animals/routes.js';
import { accessRoutes } from './modules/access/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { movementRoutes } from './modules/movements/routes.js';
import { alertRoutes } from './modules/alerts/routes.js';
import { syncRoutes } from './modules/sync/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { purchaseRoutes } from './modules/purchases/routes.js';
import { buyerRoutes } from './modules/buyers/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { photoRoutes } from './modules/photos/routes.js';
import { auditRoutes } from './modules/audit/routes.js';

export interface BuildOptions {
  config: Config;
  db: Db;
  logger?: boolean;
}

export async function buildApp({ config, db, logger = false }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { level: config.env === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    genReqId: (req) => (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].length <= 100 ? (req.headers['x-request-id'] as string) : randomUUID()),
    trustProxy: config.env === 'production',
    bodyLimit: 1_048_576,
  });

  registerContext(app, db, config);
  registerErrorHandler(app);
  registerIdempotencyHook(app);

  await app.register(helmet);
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'idempotency-replayed', 'retry-after'],
  });
  if (config.rateLimitEnabled) await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    return payload;
  });

  app.get('/health', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok', db: db.kind };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    }
  });

  app.get('/openapi.yaml', async (_req, reply) => {
    try {
      const file = await readFile(resolve(process.cwd(), config.openapiPath), 'utf8');
      return reply.type('application/yaml').send(file);
    } catch {
      return reply.code(404).send({ code: 'not_found', message: 'Contrat OpenAPI introuvable.' });
    }
  });

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(zoneRoutes);
  await app.register(vetRoutes);
  await app.register(animalRoutes);
  await app.register(accessRoutes);
  await app.register(healthRoutes);
  await app.register(movementRoutes);
  await app.register(alertRoutes);
  await app.register(syncRoutes);
  await app.register(statsRoutes);
  await app.register(historyRoutes);
  await app.register(purchaseRoutes);
  await app.register(buyerRoutes);
  await app.register(notificationRoutes);
  await app.register(photoRoutes);
  await app.register(auditRoutes);

  return app;
}
