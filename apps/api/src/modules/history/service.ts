import type { Db } from '../../db/index.js';
import { toCsv } from '../../lib/csv.js';
import { dateStr } from '../../lib/dates.js';
import { notFound } from '../../lib/errors.js';
import { escapeLike, pusher } from '../../lib/filters.js';
import { iso } from '../../lib/audit.js';
import { CATEGORY_PATTERNS, categoryOf, describeAction } from '../../lib/history.js';
import type { AuthContext } from '../../plugins/auth.js';
import { exitSql, type ExitType } from '../animals/service.js';
import { CASE_SELECT, EVENT_SELECT, toCase, toEvent } from '../health/service.js';
import type { HistoryQuery } from './schemas.js';

const EXPORT_LIMIT = 5000;

const SELECT = `
  SELECT l.id, l.at, l.action, l.detail, l.animal_id, l.actor_id,
         a.public_code, a.name AS animal_name,
         u.name AS actor_name, u.role AS actor_role,
         he.label AS event_label
  FROM audit_log l
  LEFT JOIN animals a ON a.id = l.animal_id
  LEFT JOIN users u ON u.id = l.actor_id
  LEFT JOIN health_events he ON he.id::text = l.detail->>'eventId'`;

/**
 * Qui voit quelles lignes du journal :
 * - tout le monde : ses propres actions ;
 * - l'éleveur : en plus, ce qui est arrivé à ses animaux (par exemple l'acte d'un vétérinaire),
 *   et, pour un animal qu'il a transféré, seulement jusqu'à la date du transfert.
 */
function scopeFor(auth: AuthContext): string {
  if (auth.role !== 'eleveur' && auth.role !== 'particulier') return 'l.actor_id = $1';
  return `(l.actor_id = $1
    OR l.animal_id IN (SELECT id FROM animals WHERE owner_id = $1)
    OR EXISTS (SELECT 1 FROM transfers t WHERE t.animal_id = l.animal_id AND t.from_user = $1 AND l.at <= t.created_at))`;
}

function build(auth: AuthContext, f: HistoryQuery) {
  const params: unknown[] = [auth.userId];
  const where: string[] = [scopeFor(auth)];
  const p = pusher(params);
  if (f.mine) where.push('l.actor_id = $1');
  if (f.animalId) where.push(`l.animal_id = $${p(f.animalId)}`);
  if (f.category) where.push(`l.action LIKE ANY($${p(CATEGORY_PATTERNS[f.category])}::text[])`);
  if (f.from) where.push(`l.at >= $${p(f.from)}::date`);
  if (f.to) where.push(`l.at < ($${p(f.to)}::date + 1)`);
  if (f.q) {
    const n = p(`%${escapeLike(f.q)}%`);
    where.push(`(a.name ILIKE $${n} OR a.public_code ILIKE $${n} OR u.name ILIKE $${n} OR l.action ILIKE $${n} OR he.label ILIKE $${n})`);
  }
  return { params, whereSql: where.join(' AND '), dir: f.order === 'asc' ? 'ASC' : 'DESC' };
}

const parseDetail = (d: unknown): Record<string, any> | null => {
  if (d == null) return null;
  if (typeof d === 'string') { try { return JSON.parse(d); } catch { return null; } }
  return d as Record<string, any>;
};

function toEntry(r: any, auth: AuthContext) {
  const byMe = r.actor_id === auth.userId;
  return {
    id: Number(r.id),
    at: iso(r.at)!,
    action: r.action as string,
    category: categoryOf(r.action),
    label: describeAction(r.action, parseDetail(r.detail), { eventLabel: r.event_label, byMe, actorName: r.actor_name }),
    byMe,
    actor: r.actor_id ? { id: r.actor_id as string, name: r.actor_name as string, role: r.actor_role as string } : null,
    animal: r.animal_id ? { id: r.animal_id as string, code: r.public_code as string, name: r.animal_name as string } : null,
  };
}

/** Journal de mon compte : ce que j'ai fait et ce qui est arrivé à mes animaux. */
export async function myHistory(db: Db, auth: AuthContext, f: HistoryQuery) {
  const { params, whereSql, dir } = build(auth, f);
  const total = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_log l
     LEFT JOIN animals a ON a.id = l.animal_id LEFT JOIN users u ON u.id = l.actor_id
     LEFT JOIN health_events he ON he.id::text = l.detail->>'eventId'
     WHERE ${whereSql}`,
    params,
  ))[0]!.n;
  const rows = await db.query(`${SELECT} WHERE ${whereSql} ORDER BY l.at ${dir}, l.id ${dir} LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  return { items: rows.map((r) => toEntry(r, auth)), total, page: f.page, limit: f.limit };
}

export async function exportHistoryCsv(db: Db, auth: AuthContext, f: HistoryQuery): Promise<string> {
  const { params, whereSql, dir } = build(auth, f);
  const rows = await db.query(`${SELECT} WHERE ${whereSql} ORDER BY l.at ${dir}, l.id ${dir} LIMIT ${EXPORT_LIMIT}`, params);
  const CAT: Record<string, string> = { compte: 'Compte', animal: 'Animal', sante: 'Santé', mouvement: 'Mouvement', acces: 'Accès', marche: 'Marché', alerte: 'Alerte' };
  return toCsv(
    ['date', 'heure', 'categorie', 'evenement', 'animal_code', 'animal_nom', 'auteur', 'par_moi'],
    rows.map((r) => {
      const e = toEntry(r, auth);
      return [e.at.slice(0, 10), e.at.slice(11, 19), CAT[e.category], e.label, e.animal?.code, e.animal?.name, e.actor?.name, e.byMe];
    }),
  );
}

/**
 * Dossier d'un animal que l'éleveur a transféré (ou vendu à un éleveur inscrit), figé à la date de sortie.
 * En lecture seule, et rien de ce qui a été saisi après cette date n'est visible : ni les actes, ni les cas, ni les mouvements,
 * ni l'identité du propriétaire actuel.
 */
export async function archive(db: Db, auth: AuthContext, animalId: string) {
  if (auth.role !== 'eleveur' && auth.role !== 'particulier') throw notFound('Animal introuvable.');
  const a = (await db.query('SELECT a.* FROM animals a WHERE a.id = $1', [animalId]))[0];
  // Dernier transfert que j'ai fait : sa date métier (occurred_on) et le moment réel où il a été enregistré (created_at).
  const last = (await db.query('SELECT occurred_on, created_at FROM transfers WHERE animal_id = $1 AND from_user = $2 ORDER BY created_at DESC LIMIT 1', [animalId, auth.userId]))[0];
  if (!a || !last || a.owner_id === auth.userId) throw notFound('Animal introuvable.');
  const cutoff = dateStr(last.occurred_on)!;
  // Comparaison faite par la base : un horodatage passé par JavaScript perdrait les microsecondes.
  const CUT = '(SELECT max(created_at) FROM transfers WHERE animal_id = $1 AND from_user = $3)';

  const ex = exitSql(2);
  const exit = (await db.query(`SELECT (${ex.on}) AS exit_on, (${ex.type}) AS exit_type FROM animals a WHERE a.id = $1`, [animalId, auth.userId]))[0]!;

  const events = await db.query(
    `${EVENT_SELECT} WHERE e.animal_id = $1 AND e.done_on <= $2::date AND e.created_at <= ${CUT} ORDER BY e.done_on DESC, e.created_at DESC, e.id`,
    [animalId, cutoff, auth.userId],
  );
  // une correction saisie après la sortie n'existe pas encore pour l'ancien propriétaire
  const eventDtos = events.map((e) => toEvent({ ...e, corrected_by: events.find((c) => c.corrects_event_id === e.id)?.id ?? null }));

  const cases = await db.query(
    `${CASE_SELECT} WHERE c.animal_id = $1 AND c.opened_on <= $2::date AND c.created_at <= ${CUT} ORDER BY c.opened_on DESC, c.created_at DESC`,
    [animalId, cutoff, auth.userId],
  );
  const caseDtos = cases.map((c) => {
    const closedInTime = c.closed_on && dateStr(c.closed_on)! <= cutoff;
    return toCase(closedInTime ? c : { ...c, status: 'ouvert', closed_on: null });
  });

  const flows = await db.query(
    `SELECT f.*, u.name AS recorder_name FROM flows f JOIN users u ON u.id = f.recorded_by
     WHERE f.animal_id = $1 AND f.occurred_on <= $2::date AND f.created_at <= ${CUT} ORDER BY f.occurred_on DESC, f.created_at DESC, f.id`,
    [animalId, cutoff, auth.userId],
  );

  return {
    readOnly: true as const,
    cutoff,
    exit: { type: exit.exit_type as ExitType, on: dateStr(exit.exit_on) ?? cutoff },
    animal: {
      id: a.id as string,
      code: a.public_code as string,
      kind: a.kind as string,
      species: a.species as string,
      name: a.name as string,
      breed: (a.breed ?? null) as string | null,
      sex: (a.sex ?? null) as string | null,
      bornOn: dateStr(a.born_on),
      qtyInitial: (a.qty_initial ?? null) as number | null,
      rfid: (a.rfid ?? null) as string | null,
      createdAt: iso(a.created_at),
    },
    events: eventDtos,
    cases: caseDtos,
    flows: flows.map((r) => ({
      id: r.id as string,
      type: r.type as string,
      qty: (r.qty ?? null) as number | null,
      counterpart: (r.counterpart ?? null) as string | null,
      note: (r.note ?? null) as string | null,
      occurredOn: dateStr(r.occurred_on),
      recordedBy: { id: r.recorded_by as string, name: r.recorder_name as string },
      createdAt: iso(r.created_at),
    })),
  };
}
