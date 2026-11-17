import type { Db } from '../../db/index.js';
import { forbidden } from '../../lib/errors.js';
import { toCsv } from '../../lib/csv.js';
import { dateStr } from '../../lib/dates.js';
import { isNotifiable } from '../../lib/diseases.js';
import type { AuthContext } from '../../plugins/auth.js';
import { scopeSql, userZone } from '../animals/service.js';

const DAYS = 30;

/** Indicateurs réservés à l'autorité (tout le pays) et à l'agent (sa zone). */
async function statsZone(db: Db, auth: AuthContext): Promise<string | null> {
  if (auth.role === 'autorite') return null;
  if (auth.role === 'agent') {
    const z = await userZone(db, auth.userId);
    if (!z) throw forbidden("Votre compte agent n'a pas de zone.");
    return z;
  }
  throw forbidden('Réservé aux agents et à l’autorité.');
}

export async function overview(db: Db, auth: AuthContext) {
  const zone = await statsZone(db, auth);
  const zf = '($1::uuid IS NULL OR a.zone_id = $1)';
  const p = [zone];
  const byStatus = await db.query(
    `SELECT a.status, count(*)::int AS animals, COALESCE(sum(COALESCE(a.qty, 1)), 0)::int AS heads FROM animals a WHERE ${zf} GROUP BY a.status ORDER BY a.status`, p);
  const bySpecies = await db.query(
    `SELECT a.species, count(*)::int AS animals, COALESCE(sum(COALESCE(a.qty, 1)), 0)::int AS heads FROM animals a
     WHERE ${zf} AND a.status = 'actif' GROUP BY a.species ORDER BY heads DESC`, p);
  const diseases = await db.query(
    `SELECT lower(trim(d)) AS disease, count(*)::int AS cases
     FROM cases c JOIN animals a ON a.id = c.animal_id, unnest(c.diseases) d
     WHERE ${zf} AND c.opened_on >= current_date - $2::int GROUP BY 1 ORDER BY cases DESC, disease LIMIT 10`, [zone, DAYS]);
  const open = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cases c JOIN animals a ON a.id = c.animal_id WHERE ${zf} AND c.status IN ('ouvert','suivi')`, p))[0]!.n;
  const deaths = (await db.query<{ n: number }>(
    `SELECT COALESCE(sum(f.qty), 0)::int AS n FROM flows f JOIN animals a ON a.id = f.animal_id
     WHERE ${zf} AND f.type = 'mortalite' AND f.occurred_on >= current_date - $2::int`, [zone, DAYS]))[0]!.n;
  const alerts = await db.query(
    `SELECT al.kind, count(*)::int AS n FROM alerts al WHERE al.handled_at IS NULL AND ($1::uuid IS NULL OR al.zone_id = $1) GROUP BY al.kind ORDER BY al.kind`, p);
  const vets = (await db.query<{ total: number; verified: number }>(
    `SELECT count(*)::int AS total, (count(*) FILTER (WHERE verified))::int AS verified FROM vets`))[0]!;
  return {
    scope: zone ? 'zone' : 'national',
    periodDays: DAYS,
    animalsByStatus: byStatus.map((r) => ({ status: r.status as string, animals: r.animals as number, heads: r.heads as number })),
    activeBySpecies: bySpecies.map((r) => ({ species: r.species as string, animals: r.animals as number, heads: r.heads as number })),
    topDiseases: diseases.map((r) => ({ disease: r.disease as string, cases: r.cases as number, notifiable: isNotifiable(r.disease as string) })),
    openCases: open,
    deaths: deaths,
    unhandledAlerts: Object.fromEntries(alerts.map((r) => [r.kind as string, r.n as number])),
    vets,
  };
}

export async function zones(db: Db, auth: AuthContext) {
  const zone = await statsZone(db, auth);
  const rows = await db.query(
    `SELECT z.id, z.name, z.lat, z.lng,
       (SELECT count(*)::int FROM animals a WHERE a.zone_id = z.id AND a.status = 'actif') AS animals,
       (SELECT COALESCE(sum(COALESCE(a.qty, 1)), 0)::int FROM animals a WHERE a.zone_id = z.id AND a.status = 'actif') AS heads,
       (SELECT count(*)::int FROM cases c JOIN animals a ON a.id = c.animal_id WHERE a.zone_id = z.id AND c.status IN ('ouvert','suivi')) AS open_cases,
       (SELECT COALESCE(sum(f.qty), 0)::int FROM flows f JOIN animals a ON a.id = f.animal_id
         WHERE a.zone_id = z.id AND f.type = 'mortalite' AND f.occurred_on >= current_date - $2::int) AS deaths,
       (SELECT count(*)::int FROM animals a WHERE a.zone_id = z.id AND a.status = 'vole') AS stolen,
       (SELECT count(*)::int FROM alerts al WHERE al.zone_id = z.id AND al.handled_at IS NULL) AS unhandled
     FROM zones z WHERE ($1::uuid IS NULL OR z.id = $1) ORDER BY z.name`,
    [zone, DAYS],
  );
  return {
    periodDays: DAYS,
    items: rows.map((r) => {
      const heads = r.heads as number, deaths = r.deaths as number;
      return {
        zone: { id: r.id as string, name: r.name as string, lat: r.lat as number | null, lng: r.lng as number | null },
        animals: r.animals as number,
        heads,
        openCases: r.open_cases as number,
        deaths,
        mortalityRate: heads + deaths === 0 ? 0 : Math.round((deaths / (heads + deaths)) * 10000) / 10000,
        stolen: r.stolen as number,
        unhandledAlerts: r.unhandled as number,
      };
    }),
  };
}

// ---------- Exports CSV ----------

const EXPORT_LIMIT = 10_000;

export async function exportAnimalsCsv(db: Db, auth: AuthContext): Promise<string> {
  const scope = scopeSql(auth, auth.role === 'agent' ? await userZone(db, auth.userId) : null, 1);
  const rows = await db.query(
    `SELECT a.*, z.name AS zone_name, o.name AS owner_name FROM animals a
     JOIN zones z ON z.id = a.zone_id JOIN users o ON o.id = a.owner_id
     WHERE ${scope.sql} ORDER BY a.created_at, a.id LIMIT ${EXPORT_LIMIT}`,
    scope.params,
  );
  return toCsv(
    ['code', 'espece', 'type', 'nom', 'race', 'sexe', 'naissance', 'statut', 'effectif', 'effectif_initial', 'poids_moyen_kg', 'boucle_rfid', 'zone', 'proprietaire'],
    rows.map((r) => [r.public_code, r.species, r.kind, r.name, r.breed, r.sex, dateStr(r.born_on), r.status, r.qty, r.qty_initial, r.avg_weight_kg == null ? null : Number(r.avg_weight_kg), r.rfid, r.zone_name, r.owner_name]),
  );
}

export async function exportCasesCsv(db: Db, auth: AuthContext): Promise<string> {
  const scope = scopeSql(auth, auth.role === 'agent' ? await userZone(db, auth.userId) : null, 1);
  const rows = await db.query(
    `SELECT c.*, a.public_code, a.species, z.name AS zone_name FROM cases c
     JOIN animals a ON a.id = c.animal_id JOIN zones z ON z.id = a.zone_id
     WHERE ${scope.sql} ORDER BY c.opened_on DESC, c.id LIMIT ${EXPORT_LIMIT}`,
    scope.params,
  );
  return toCsv(
    ['animal', 'espece', 'zone', 'maladies', 'declaration_obligatoire', 'malades', 'morts', 'gravite', 'statut', 'ouvert_le', 'clos_le'],
    rows.map((r) => [r.public_code, r.species, r.zone_name, (r.diseases as string[]).join(' | '), (r.diseases as string[]).some(isNotifiable), r.affected_count, r.deaths, r.severity, r.status, dateStr(r.opened_on), dateStr(r.closed_on)]),
  );
}
