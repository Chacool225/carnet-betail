import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken, type AccessClaims } from '../lib/tokens.js';

export type Role = AccessClaims['role'];

export interface AuthContext {
  userId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: Config;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
    idem: { userId: string; key: string } | null;
  }
}

/** Branche la base, la configuration et les champs de requête sur l'instance racine. */
export function registerContext(app: FastifyInstance, db: Db, config: Config): void {
  app.decorate('db', db);
  app.decorate('config', config);
  app.decorateRequest('auth', null);
  app.decorateRequest('idem', null);
}

/**
 * Vérifie le jeton d'accès et s'assure que le compte existe toujours.
 * Le rôle vient de la base, pas du jeton : un changement de rôle est effectif tout de suite.
 */
export const authenticate: preHandlerAsyncHookHandler = async function (this: FastifyInstance, req: FastifyRequest) {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) throw unauthorized();
  let claims: AccessClaims;
  try {
    claims = await verifyAccessToken(this.config.jwtSecret, header.slice(7).trim());
  } catch {
    throw unauthorized('Session expirée ou invalide.', 'invalid_token');
  }
  const rows = await this.db.query<{ id: string; role: Role }>('SELECT id, role FROM users WHERE id = $1', [claims.sub]);
  if (!rows.length) throw unauthorized('Compte introuvable.', 'invalid_token');
  req.auth = { userId: rows[0]!.id, role: rows[0]!.role };
};

/** À placer après `authenticate`. */
export function requireRole(...roles: Role[]): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.auth) throw unauthorized();
    if (!roles.includes(req.auth.role)) throw forbidden();
  };
}

export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
