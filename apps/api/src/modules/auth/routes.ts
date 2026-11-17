import type { FastifyInstance } from 'fastify';
import { authenticate, authOf } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import * as svc from './service.js';
import { changePasswordBody, loginBody, pinLoginBody, refreshBody, registerBody, setPinBody } from './schemas.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Limites plus strictes sur les routes sensibles (ignorées si le rate-limit est désactivé).
  const strict = app.config.rateLimitEnabled ? { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } } : {};
  const ua = (req: { headers: Record<string, unknown> }) => (typeof req.headers['user-agent'] === 'string' ? (req.headers['user-agent'] as string) : undefined);

  app.post('/auth/register', strict, async (req, reply) => {
    const body = registerBody.parse(req.body);
    return reply.code(201).send(await svc.register(app.db, app.config, body, ua(req)));
  });

  app.post('/auth/login', strict, async (req) => svc.login(app.db, app.config, loginBody.parse(req.body), ua(req)));

  app.post('/auth/pin-login', strict, async (req) => svc.pinLogin(app.db, app.config, pinLoginBody.parse(req.body), ua(req)));

  app.post('/auth/refresh', strict, async (req) => svc.refresh(app.db, app.config, refreshBody.parse(req.body).refreshToken, ua(req)));

  app.post('/auth/logout', async (req, reply) => {
    await svc.logout(app.db, refreshBody.parse(req.body).refreshToken);
    return reply.code(204).send();
  });

  app.post('/auth/change-password', { preHandler: [authenticate, idempotent], ...strict }, async (req, reply) => {
    const b = changePasswordBody.parse(req.body);
    await svc.changePassword(app.db, app.config, authOf(req).userId, b.currentPassword, b.newPassword);
    return reply.code(204).send();
  });

  app.post('/auth/pin', { preHandler: [authenticate, idempotent], ...strict }, async (req, reply) => {
    const b = setPinBody.parse(req.body);
    await svc.setPin(app.db, app.config, authOf(req).userId, b.password, b.pin);
    return reply.code(204).send();
  });
}
