import type { Queryable } from '../db/index.js';

export interface NewAlert {
  kind: 'vol' | 'sanitaire' | 'anomalie';
  severity: 'haute' | 'moyenne' | 'basse';
  zoneId: string | null;
  animalId?: string | null;
  title: string;
  why?: string | null;
}

/** Crée une alerte. À appeler dans la transaction de l'action qui la provoque. */
export async function createAlert(q: Queryable, a: NewAlert): Promise<string> {
  const r = await q.query<{ id: string }>(
    'INSERT INTO alerts (kind, severity, zone_id, animal_id, title, why) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [a.kind, a.severity, a.zoneId, a.animalId ?? null, a.title, a.why ?? null],
  );
  return r[0]!.id;
}

/** Nombre de jours et d'animaux touchés à partir desquels une même maladie devient un foyer suspect. */
export const OUTBREAK_DAYS = 14;
export const OUTBREAK_MIN_ANIMALS = 3;
/** Une mortalité d'au moins 20 % d'un lot de 10 têtes ou plus, en une seule déclaration, est une anomalie. */
export const MORTALITY_ALERT_RATIO = 0.2;
export const MORTALITY_ALERT_MIN_STOCK = 10;

/**
 * Foyer suspect : au moins 3 animaux de la même zone touchés par la même maladie en 14 jours.
 * Une seule alerte par maladie et par zone sur la période.
 */
export async function checkOutbreak(q: Queryable, zoneId: string, zoneName: string, disease: string): Promise<boolean> {
  const key = disease.trim().toLowerCase();
  const n = (
    await q.query<{ n: number }>(
      `SELECT count(DISTINCT c.animal_id)::int AS n
       FROM cases c JOIN animals a ON a.id = c.animal_id
       WHERE a.zone_id = $1 AND c.opened_on >= current_date - $3::int
         AND EXISTS (SELECT 1 FROM unnest(c.diseases) d WHERE lower(trim(d)) = $2)`,
      [zoneId, key, OUTBREAK_DAYS],
    )
  )[0]!.n;
  if (n < OUTBREAK_MIN_ANIMALS) return false;
  const title = `Foyer suspect : ${key}`;
  const dup = await q.query(
    `SELECT 1 FROM alerts WHERE zone_id = $1 AND kind = 'sanitaire' AND title = $2 AND created_on >= current_date - $3::int`,
    [zoneId, title, OUTBREAK_DAYS],
  );
  if (dup.length) return false;
  await createAlert(q, {
    kind: 'sanitaire',
    severity: 'moyenne',
    zoneId,
    title,
    why: `${n} élevages de ${zoneName} touchés en ${OUTBREAK_DAYS} jours.`,
  });
  return true;
}
