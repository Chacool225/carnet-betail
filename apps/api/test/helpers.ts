import type { FastifyInstance } from 'fastify';
import { loadConfig, type Config } from '../src/config.js';
import { createDb, type Db } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { seed } from '../src/scripts/seed.js';

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  config: Config;
  close(): Promise<void>;
}

export async function setup(overrides: Record<string, string> = {}): Promise<TestCtx> {
  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    RATE_LIMIT_ENABLED: 'false',
    ...overrides,
  });
  const db = await createDb({ pgliteDir: 'memory://' });
  await migrate(db);
  await db.tx((q) => seed(q));
  const app = await buildApp({ config, db });
  await app.ready();
  return { app, db, config, async close() { await app.close(); await db.close(); } };
}

export const PWD = 'Demo1234!';

export async function login(app: FastifyInstance, identifier: string, password = PWD) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { identifier, password } });
  return { res, body: res.json() as any };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
