import { z, ZodError } from 'zod';
import type { Db } from '../../db/index.js';
import { AppError, conflict, forbidden, invalid } from '../../lib/errors.js';
import { iso } from '../../lib/audit.js';
import type { AuthContext } from '../../plugins/auth.js';
import { BASE, createAnimal, getAnimal, photosFor, scopeSql, toAnimal, updateAnimal, userZone } from '../animals/service.js';
import { createAnimalBody, updateAnimalBody } from '../animals/schemas.js';
import { CASE_SELECT, EVENT_SELECT, createCase, createEvent, declareMortality, toCase, toEvent, updateCase } from '../health/service.js';
import { createCaseBody, createEventBody, mortalityBody, updateCaseBody } from '../health/schemas.js';
import { declareTheft, sell } from '../movements/service.js';
import { sellBody, theftBody } from '../movements/schemas.js';

export const MAX_OPS = 100;

export const opSchema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(['animal.create', 'animal.update', 'health.create', 'mortality.declare', 'case.create', 'case.update', 'sale', 'theft.declare']),
  payload: z.record(z.unknown()),
});
export const batchBody = z.object({ ops: z.array(opSchema).min(1).max(MAX_OPS) });
export type Op = z.infer<typeof opSchema>;

export interface OpResult {
  clientId: string;
  status: 'ok' | 'error';
  replayed: boolean;
  result?: unknown;
  error?: { code: string; message: string; status: number; details?: unknown };
}

const uuid = z.string().uuid();

/** Un identifiant d'animal ou de signalement peut être « ref:<clientId> » : l'objet créé plus tôt dans le même envoi. */
async function resolveRef(db: Db, auth: AuthContext, value: unknown, field: string): Promise<string> {
  if (typeof value !== 'string') throw invalid(`${field} est obligatoire.`, [{ path: [field], message: 'Obligatoire.' }]);
  if (!value.startsWith('ref:')) return uuid.parse(value);
  const clientId = value.slice(4);
  if (!uuid.safeParse(clientId).success) throw invalid(`Référence invalide : ${value}`, [{ path: [field], message: 'Référence invalide.' }]);
  const r = (await db.query('SELECT result FROM client_ops WHERE client_id = $1 AND user_id = $2 AND status = $3', [clientId, auth.userId, 'ok']))[0];
  const id = r?.result?.id;
  if (!id) throw invalid(`Référence introuvable : ${value} (l'opération doit venir avant et avoir réussi).`, [{ path: [field], message: 'Référence introuvable.' }], 'ref_not_found');
  return id as string;
}

type Handler = (db: Db, auth: AuthContext, payload: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<Op['type'], Handler> = {
  'animal.create': async (db, auth, p) => {
    if (auth.role !== 'eleveur') throw forbidden('Seul un éleveur crée une fiche.');
    const a = await createAnimal(db, auth, createAnimalBody.parse(p));
    return { id: a.id, code: a.code };
  },
  'animal.update': async (db, auth, p) => {
    const { animalId, baseUpdatedAt, ...rest } = p;
    const id = await resolveRef(db, auth, animalId, 'animalId');
    if (baseUpdatedAt !== undefined) {
      // Conflit : la fiche a changé sur le serveur depuis la version que le téléphone avait lue.
      const base = z.string().datetime().parse(baseUpdatedAt);
      const server = await getAnimal(db, auth, id);
      if (server.updatedAt && new Date(server.updatedAt).getTime() > new Date(base).getTime()) {
        throw conflict('conflict_stale', 'La fiche a été modifiée ailleurs depuis votre dernière synchronisation.', { server });
      }
    }
    const a = await updateAnimal(db, auth, id, updateAnimalBody.parse(rest));
    return { id: a.id, updatedAt: a.updatedAt };
  },
  'health.create': async (db, auth, p) => {
    const { animalId, ...rest } = p;
    const e = await createEvent(db, auth, await resolveRef(db, auth, animalId, 'animalId'), createEventBody.parse(rest));
    return { id: e.id };
  },
  'mortality.declare': async (db, auth, p) => {
    const { animalId, ...rest } = p;
    const r = await declareMortality(db, auth, await resolveRef(db, auth, animalId, 'animalId'), mortalityBody.parse(rest));
    return { id: r.animalId, qty: r.qty, status: r.status };
  },
  'case.create': async (db, auth, p) => {
    const { animalId, ...rest } = p;
    const c = await createCase(db, auth, await resolveRef(db, auth, animalId, 'animalId'), createCaseBody.parse(rest));
    return { id: c.id };
  },
  'case.update': async (db, auth, p) => {
    const { caseId, ...rest } = p;
    const c = await updateCase(db, auth, await resolveRef(db, auth, caseId, 'caseId'), updateCaseBody.parse(rest));
    return { id: c.id, status: c.status };
  },
  sale: async (db, auth, p) => {
    const { animalId, ...rest } = p;
    const r = await sell(db, auth, await resolveRef(db, auth, animalId, 'animalId'), sellBody.parse(rest));
    return { id: r.animalId, status: r.status, qty: r.qty };
  },
  'theft.declare': async (db, auth, p) => {
    const { animalId, ...rest } = p;
    const r = await declareTheft(db, auth, await resolveRef(db, auth, animalId, 'animalId'), theftBody.parse(rest));
    return { id: r.animalId, status: r.status };
  },
};

const toError = (e: unknown): NonNullable<OpResult['error']> => {
  if (e instanceof AppError) return { code: e.code, message: e.message, status: e.status, ...(e.details !== undefined ? { details: e.details } : {}) };
  if (e instanceof ZodError) {
    return { code: 'validation_error', message: 'Certaines données sont invalides.', status: 422, details: e.issues.map((i) => ({ path: i.path, message: i.message })) };
  }
  return { code: 'internal_error', message: 'Erreur interne sur cette opération.', status: 500 };
};

/** Opérations en cours de traitement dans ce processus : deux envois simultanés de la même opération ne l'exécutent qu'une fois. */
const inflight = new Map<string, Promise<OpResult>>();

async function execute(db: Db, auth: AuthContext, op: Op): Promise<OpResult> {
  try {
    const result = await handlers[op.type](db, auth, op.payload);
    await db.query(
      `INSERT INTO client_ops (client_id, user_id, type, status, result) VALUES ($1,$2,$3,'ok',$4::jsonb) ON CONFLICT (client_id) DO NOTHING`,
      [op.clientId, auth.userId, op.type, JSON.stringify(result)],
    );
    return { clientId: op.clientId, status: 'ok', replayed: false, result };
  } catch (e) {
    // Un échec n'est pas mémorisé : l'opération n'a rien écrit, le client peut la corriger et la renvoyer.
    return { clientId: op.clientId, status: 'error', replayed: false, error: toError(e) };
  }
}

/** RG9 : une opération déjà réussie (même clientId) renvoie son résultat d'origine sans rien refaire. */
export async function runOne(db: Db, auth: AuthContext, op: Op): Promise<OpResult> {
  const existing = (await db.query('SELECT user_id, type, result FROM client_ops WHERE client_id = $1', [op.clientId]))[0];
  if (existing) {
    if (existing.user_id !== auth.userId || existing.type !== op.type) {
      return { clientId: op.clientId, status: 'error', replayed: false, error: { code: 'client_id_conflict', message: 'Cet identifiant est déjà utilisé pour une autre opération.', status: 409 } };
    }
    return { clientId: op.clientId, status: 'ok', replayed: true, result: existing.result };
  }
  const running = inflight.get(op.clientId);
  if (running) return { ...(await running), replayed: true };
  const p = execute(db, auth, op);
  inflight.set(op.clientId, p);
  try {
    return await p;
  } finally {
    inflight.delete(op.clientId);
  }
}

/** Les opérations sont traitées dans l'ordre reçu ; une erreur n'arrête pas les suivantes. */
export async function runBatch(db: Db, auth: AuthContext, ops: Op[]): Promise<{ results: OpResult[] }> {
  const results: OpResult[] = [];
  for (const op of ops) results.push(await runOne(db, auth, op));
  return { results };
}

export const pullQuery = z.object({ since: z.string().datetime().optional() });
const PULL_LIMIT = 500;

/** Tout ce qui a changé depuis `since` sur les animaux visibles. Le client conserve `serverTime` pour son prochain appel. */
export async function pull(db: Db, auth: AuthContext, since?: string) {
  const serverTime = (await db.query<{ t: Date }>('SELECT now() AS t'))[0]!.t; // lu avant les requêtes : rien ne se perd entre deux appels
  const s = since ?? '1970-01-01T00:00:00.000Z';
  const scope = scopeSql(auth, auth.role === 'agent' ? await userZone(db, auth.userId) : null, 1);
  const n = scope.params.length + 1;
  const animals = await db.query(`${BASE} WHERE ${scope.sql} AND a.updated_at > $${n}::timestamptz ORDER BY a.updated_at, a.id LIMIT ${PULL_LIMIT + 1}`, [...scope.params, s]);
  const events = await db.query(
    `${EVENT_SELECT} WHERE e.animal_id IN (SELECT a.id FROM animals a WHERE ${scope.sql})
       AND (e.created_at > $${n}::timestamptz OR c.created_at > $${n}::timestamptz)
     ORDER BY e.created_at, e.id LIMIT ${PULL_LIMIT + 1}`,
    [...scope.params, s],
  );
  const cases = await db.query(
    `${CASE_SELECT} WHERE c.animal_id IN (SELECT a.id FROM animals a WHERE ${scope.sql}) AND (c.created_at > $${n}::timestamptz OR c.closed_on >= $${n}::timestamptz::date)
     ORDER BY c.created_at, c.id LIMIT ${PULL_LIMIT + 1}`,
    [...scope.params, s],
  );
  const hasMore = animals.length > PULL_LIMIT || events.length > PULL_LIMIT || cases.length > PULL_LIMIT;
  const a = animals.slice(0, PULL_LIMIT);
  const photos = await photosFor(db, a.map((r) => r.id));
  return {
    serverTime: iso(serverTime)!,
    hasMore,
    animals: a.map((r) => toAnimal(r, photos.get(r.id) ?? [])),
    healthEvents: events.slice(0, PULL_LIMIT).map(toEvent),
    cases: cases.slice(0, PULL_LIMIT).map(toCase),
  };
}
