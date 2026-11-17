import type { Queryable } from '../db/index.js';

/** Écrit une ligne dans le journal d'audit (table en ajout seul). À appeler dans la même transaction que l'action. */
export async function writeAudit(
  q: Queryable,
  e: { actorId?: string | null; animalId?: string | null; action: string; detail?: unknown },
): Promise<void> {
  await q.query('INSERT INTO audit_log (actor_id, animal_id, action, detail) VALUES ($1, $2, $3, $4)', [
    e.actorId ?? null,
    e.animalId ?? null,
    e.action,
    e.detail === undefined ? null : JSON.stringify(e.detail),
  ]);
}

export const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
