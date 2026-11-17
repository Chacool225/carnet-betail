import type { Db, Queryable, Row } from '../../db/index.js';
import { AppError, forbidden, invalid, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { dateStr } from '../../lib/dates.js';
import type { AuthContext } from '../../plugins/auth.js';
import { loadVisible } from '../animals/service.js';

/** RG1 : un accès vétérinaire dure 30 jours, renouvelé à chaque scan ou soin. */
export const ACCESS_DAYS = 30;

export type GrantSource = 'scan' | 'soin' | 'invitation' | 'enregistrement';

export interface GrantDto {
  animalId: string;
  vetId: string;
  vetName: string;
  source: GrantSource;
  grantedOn: string | null;
  expiresOn: string | null;
  revokedOn: string | null;
  active: boolean;
}

const toGrant = (r: Row): GrantDto => ({
  animalId: r.animal_id,
  vetId: r.vet_id,
  vetName: r.vet_name,
  source: r.source,
  grantedOn: dateStr(r.granted_on),
  expiresOn: dateStr(r.expires_on),
  revokedOn: dateStr(r.revoked_on),
  active: r.revoked_on == null && dateStr(r.expires_on)! >= dateStr(r.today)!,
});

const SELECT_GRANT = `SELECT g.*, u.name AS vet_name, current_date AS today
  FROM access_grants g JOIN users u ON u.id = g.vet_id`;

async function assertVerifiedVet(q: Queryable, vetId: string): Promise<void> {
  const v = await q.query('SELECT verified FROM vets WHERE user_id = $1', [vetId]);
  if (!v.length) throw invalid("Ce compte n'est pas un vétérinaire.", [{ path: ['vetId'], message: 'Vétérinaire inconnu.' }]);
  if (!v[0]!.verified) {
    throw new AppError(403, 'vet_not_verified', "Le numéro d'ordre de ce vétérinaire n'a pas encore été vérifié.");
  }
}

/** Crée l'accès ou le prolonge de 30 jours. Un accès retiré ne se prolonge pas : il en naît un nouveau. */
export async function grantOrRenew(q: Queryable, animalId: string, vetId: string, source: GrantSource): Promise<{ created: boolean; expiresOn: string }> {
  const existing = await q.query('SELECT 1 FROM access_grants WHERE animal_id = $1 AND vet_id = $2 AND revoked_on IS NULL', [animalId, vetId]);
  const row = (
    await q.query(
      `INSERT INTO access_grants (animal_id, vet_id, source, expires_on)
       VALUES ($1, $2, $3, current_date + $4::int)
       ON CONFLICT (animal_id, vet_id) WHERE revoked_on IS NULL
       DO UPDATE SET expires_on = current_date + $4::int
       RETURNING expires_on`,
      [animalId, vetId, source, ACCESS_DAYS],
    )
  )[0]!;
  return { created: existing.length === 0, expiresOn: dateStr(row.expires_on)! };
}

/** Prolonge un accès existant (appelé quand le vétérinaire enregistre un soin). Sans effet s'il n'y en a pas. */
export async function renewIfAny(q: Queryable, animalId: string, vetId: string): Promise<void> {
  await q.query(
    `UPDATE access_grants SET expires_on = current_date + $3::int
     WHERE animal_id = $1 AND vet_id = $2 AND revoked_on IS NULL`,
    [animalId, vetId, ACCESS_DAYS],
  );
}

/** Le vétérinaire scanne un animal : il obtient (ou prolonge) son accès de 30 jours. */
export async function scan(db: Db, auth: AuthContext, by: { code?: string; rfid?: string }) {
  return db.tx(async (q) => {
    await assertVerifiedVet(q, auth.userId);
    const rows = by.code
      ? await q.query('SELECT id, status FROM animals WHERE public_code = $1', [by.code])
      : await q.query('SELECT id, status FROM animals WHERE rfid = $1', [by.rfid]);
    const a = rows[0];
    if (!a) throw notFound('Aucun animal ne correspond à ce code.', 'animal_not_found');
    const g = await grantOrRenew(q, a.id, auth.userId, 'scan');
    await writeAudit(q, { actorId: auth.userId, animalId: a.id, action: g.created ? 'access.granted' : 'access.renewed', detail: { source: 'scan' } });
    return { animalId: a.id, stolen: a.status === 'vole', created: g.created, expiresOn: g.expiresOn };
  });
}

/** L'éleveur invite un vétérinaire vérifié sur un de ses animaux. */
export async function invite(db: Db, auth: AuthContext, animalId: string, vetId: string) {
  return db.tx(async (q) => {
    const { level } = await loadVisible(q, auth, animalId, true);
    if (level !== 'owner') throw forbidden("Seul le propriétaire peut donner l'accès.");
    await assertVerifiedVet(q, vetId);
    const g = await grantOrRenew(q, animalId, vetId, 'invitation');
    await writeAudit(q, { actorId: auth.userId, animalId, action: g.created ? 'access.granted' : 'access.renewed', detail: { source: 'invitation', vetId } });
    return { animalId, vetId, expiresOn: g.expiresOn, created: g.created };
  });
}

/** Retire l'accès. L'historique de santé déjà écrit par ce vétérinaire reste en place (RG3). */
export async function revoke(db: Db, auth: AuthContext, animalId: string, vetId: string): Promise<void> {
  await db.tx(async (q) => {
    const { level } = await loadVisible(q, auth, animalId, true);
    if (level !== 'owner') throw forbidden("Seul le propriétaire peut retirer l'accès.");
    const r = await q.query(
      'UPDATE access_grants SET revoked_on = current_date WHERE animal_id = $1 AND vet_id = $2 AND revoked_on IS NULL RETURNING id',
      [animalId, vetId],
    );
    if (!r.length) throw notFound('Aucun accès en cours pour ce vétérinaire.');
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'access.revoked', detail: { vetId } });
  });
}

export async function listForAnimal(db: Db, auth: AuthContext, animalId: string): Promise<{ items: GrantDto[] }> {
  const { level } = await loadVisible(db, auth, animalId);
  if (level !== 'owner' && level !== 'autorite') throw forbidden();
  const rows = await db.query(`${SELECT_GRANT} WHERE g.animal_id = $1 ORDER BY g.granted_on DESC, g.id`, [animalId]);
  return { items: rows.map(toGrant) };
}

/** Les accès en cours du vétérinaire connecté, avec un résumé de chaque animal. */
export async function listMine(db: Db, auth: AuthContext) {
  const rows = await db.query(
    `SELECT g.expires_on, g.source, a.id, a.public_code, a.name, a.species, a.kind, a.status, o.name AS owner_name, z.name AS zone_name
     FROM access_grants g
     JOIN animals a ON a.id = g.animal_id
     JOIN users o ON o.id = a.owner_id
     JOIN zones z ON z.id = a.zone_id
     WHERE g.vet_id = $1 AND g.revoked_on IS NULL AND g.expires_on >= current_date
     ORDER BY g.expires_on, a.name`,
    [auth.userId],
  );
  return {
    items: rows.map((r) => ({
      animal: { id: r.id, code: r.public_code, name: r.name, species: r.species, kind: r.kind, status: r.status, ownerName: r.owner_name, zone: r.zone_name },
      source: r.source as GrantSource,
      expiresOn: dateStr(r.expires_on),
    })),
  };
}

