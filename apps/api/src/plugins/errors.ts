import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

/** Toutes les erreurs sortent sous la même forme : { code, message, details? }. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      const headers = err.status === 429 && (err.details as any)?.retryAfterSeconds ? { 'retry-after': String((err.details as any).retryAfterSeconds) } : {};
      return reply.headers(headers).code(err.status).send({ code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) });
    }
    if (err instanceof ZodError) {
      return reply.code(422).send({
        code: 'validation_error',
        message: 'Certaines données sont invalides.',
        details: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    if (err?.statusCode === 429) {
      return reply.code(429).send({ code: 'too_many_requests', message: 'Trop de requêtes. Réessayez dans un instant.' });
    }
    if (err?.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ code: 'bad_request', message: 'Requête mal formée.' });
    }
    req.log.error({ err }, 'erreur non gérée');
    return reply.code(500).send({ code: 'internal_error', message: 'Erreur interne. Réessayez plus tard.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ code: 'not_found', message: 'Route introuvable.' }));
}
