import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./.data/pglite'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères'),
  ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
  OPENAPI_PATH: z.string().default('../../packages/contract/openapi.yaml'),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl?: string;
  pgliteDir: string;
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  corsOrigins: string[];
  loginMaxAttempts: number;
  lockMinutes: number;
  rateLimitEnabled: boolean;
  openapiPath: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && !e.DATABASE_URL) {
    throw new Error('Configuration invalide :\n  - DATABASE_URL est obligatoire en production');
  }
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL || undefined,
    pgliteDir: e.PGLITE_DIR,
    jwtSecret: e.JWT_SECRET,
    accessTtlSeconds: e.ACCESS_TTL_SECONDS,
    refreshTtlDays: e.REFRESH_TTL_DAYS,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    loginMaxAttempts: e.LOGIN_MAX_ATTEMPTS,
    lockMinutes: e.LOCK_MINUTES,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED === 'true',
    openapiPath: e.OPENAPI_PATH,
  };
}
