import { z } from 'zod';
import type { Db, Row } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { iso, writeAudit } from '../../lib/audit.js';
import { dateStr } from '../../lib/dates.js';
import type { AuthContext } from '../../plugins/auth.js';
import { userZone } from '../animals/service.js';

export const alertsQuery = z.object({
  kind: z.enum(['vol', 'sanitaire', 'anomalie']).optional(),
  handled: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AlertsQuery = z.infer<typeof alertsQuery>;

const SELECT = `
  SELECT al.*, z.name AS zone_name, a.public_code, a.name AS animal_name, a.owner_id, h.name AS handler_name
  FROM alerts al
  LEFT JOIN zones z ON z.id = al.zone_id
  LEFT JOIN animals a ON a.id = al.animal_id
  LEFT JOIN users h ON h.id = al.handled_by`;

/**
 * Qui voit quelles alertes :
 * - autorité : toutes ; agent : celles de sa zone ;
 * - éleveur et vétérinaire : les alertes sanitaires de leur zone, et celles de leurs propres animaux.
 */
function scope(auth: AuthContext, zoneId: string | null): { sql: string; params: unknown[] } {
  if (auth.role === 'autorite') return { sql: 'true', params: [] };
  if (auth.role === 'agent') return zoneId ? { sql: 'al.zone_id = $1', params: [zoneId] } : { sql: 'false', params: [] };
  const own = auth.role === 'eleveur' ? ' OR a.owner_id = $2' : '';
  return {
    sql: `((al.zone_id = $1 AND al.kind = 'sanitaire')${own})`,
    params: auth.role === 'eleveur' ? [zoneId, auth.userId] : [zoneId],
  };
}

/** Les agents, l'autorité et le propriétaire voient de quel animal il s'agit ; les autres éleveurs ne voient que la zone et le motif. */
const toAlert = (r: Row, auth: AuthContext) => {
  const privileged = auth.role === 'autorite' || auth.role === 'agent' || r.owner_id === auth.userId;
  return {
    id: r.id as string,
    kind: r.kind as string,
    severity: r.severity as string,
    zone: r.zone_id ? { id: r.zone_id as string, name: r.zone_name as string } : null,
    animal: r.animal_id && privileged ? { id: r.animal_id as string, code: r.public_code as string, name: r.animal_name as string } : null,
    title: r.title as string,
    why: (r.why ?? null) as string | null,
    createdOn: dateStr(r.created_on),
    handled: r.handled_at != null,
    handledBy: r.handler_name ? (r.handler_name as string) : null,
    handledAt: iso(r.handled_at),
  };
};

export async function listAlerts(db: Db, auth: AuthContext, f: AlertsQuery) {
  const zone = await userZone(db, auth.userId);
  const s = scope(auth, zone);
  const params = [...s.params];
  const where = [s.sql];
  if (f.kind) { params.push(f.kind); where.push(`al.kind = $${params.length}`); }
  if (f.handled) where.push(f.handled === 'true' ? 'al.handled_at IS NOT NULL' : 'al.handled_at IS NULL');
  const w = where.join(' AND ');
  const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM alerts al LEFT JOIN animals a ON a.id = al.animal_id WHERE ${w}`, params))[0]!.n;
  const rows = await db.query(
    `${SELECT} WHERE ${w}
     ORDER BY (al.handled_at IS NOT NULL), CASE al.severity WHEN 'haute' THEN 0 WHEN 'moyenne' THEN 1 ELSE 2 END, al.created_on DESC, al.id
     LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`,
    params,
  );
  return { items: rows.map((r) => toAlert(r, auth)), total, page: f.page, limit: f.limit };
}

/** Un agent ou l'autorité prend en charge une alerte. */
export async function handleAlert(db: Db, auth: AuthContext, id: string) {
  return db.tx(async (q) => {
    const row = (await q.query(`${SELECT} WHERE al.id = $1 FOR UPDATE OF al`, [id]))[0];
    if (!row) throw notFound('Alerte introuvable.');
    if (auth.role === 'agent' && row.zone_id !== (await userZone(q, auth.userId))) throw notFound('Alerte introuvable.');
    if (row.handled_at) throw new AppError(409, 'already_handled', 'Cette alerte est déjà prise en charge.');
    await q.query('UPDATE alerts SET handled_by = $2, handled_at = now() WHERE id = $1', [id, auth.userId]);
    await writeAudit(q, { actorId: auth.userId, animalId: row.animal_id, action: 'alert.handled', detail: { alertId: id } });
    return toAlert((await q.query(`${SELECT} WHERE al.id = $1`, [id]))[0]!, auth);
  });
}

/** Tableau de bord de l'agent de terrain : sa zone en un coup d'œil. */
export async function agentOverview(db: Db, auth: AuthContext) {
  const zone = await userZone(db, auth.userId);
  if (!zone) return { zone: null, animals: 0, heads: 0, openCases: 0, stolen: 0, unhandledAlerts: 0 };
  const r = (
    await db.query(
      `SELECT z.name,
         (SELECT count(*)::int FROM animals a WHERE a.zone_id = z.id AND a.status = 'actif') AS animals,
         (SELECT COALESCE(sum(COALESCE(a.qty, 1)), 0)::int FROM animals a WHERE a.zone_id = z.id AND a.status = 'actif') AS heads,
         (SELECT count(*)::int FROM cases c JOIN animals a ON a.id = c.animal_id WHERE a.zone_id = z.id AND c.status IN ('ouvert','suivi')) AS open_cases,
         (SELECT count(*)::int FROM animals a WHERE a.zone_id = z.id AND a.status = 'vole') AS stolen,
         (SELECT count(*)::int FROM alerts al WHERE al.zone_id = z.id AND al.handled_at IS NULL) AS unhandled
       FROM zones z WHERE z.id = $1`,
      [zone],
    )
  )[0]!;
  return { zone: { id: zone, name: r.name as string }, animals: r.animals as number, heads: r.heads as number, openCases: r.open_cases as number, stolen: r.stolen as number, unhandledAlerts: r.unhandled as number };
}
