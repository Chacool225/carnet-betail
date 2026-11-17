import type { Db, Queryable, Row } from '../../db/index.js';
import { AppError, conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { iso, writeAudit } from '../../lib/audit.js';
import { dateStr } from '../../lib/dates.js';
import type { AuthContext } from '../../plugins/auth.js';
import {
  MAX_PHOTOS, SPECIES_PREFIX,
  type CreateAnimalBody, type ListQuery, type Species, type UpdateAnimalBody,
} from './schemas.js';

export type AccessLevel = 'owner' | 'vet' | 'agent' | 'autorite';

export interface AnimalDto {
  id: string;
  code: string;
  kind: 'individual' | 'lot';
  species: Species;
  breed: string | null;
  name: string;
  sex: 'M' | 'F' | null;
  bornOn: string | null;
  status: string;
  qty: number | null;
  qtyInitial: number | null;
  avgWeightKg: number | null;
  rfid: string | null;
  zone: { id: string; name: string };
  owner: { id: string; name: string };
  photos: { id: string; url: string }[];
  createdAt: string | null;
  updatedAt: string | null;
}

export const BASE = `
  SELECT a.*, z.name AS zone_name, o.name AS owner_name
  FROM animals a
  JOIN zones z ON z.id = a.zone_id
  JOIN users o ON o.id = a.owner_id`;


export function toAnimal(r: Row, photos: Row[] = []): AnimalDto {
  return {
    id: r.id,
    code: r.public_code,
    kind: r.kind,
    species: r.species,
    breed: r.breed ?? null,
    name: r.name,
    sex: r.sex ?? null,
    bornOn: dateStr(r.born_on),
    status: r.status,
    qty: r.qty ?? null,
    qtyInitial: r.qty_initial ?? null,
    avgWeightKg: r.avg_weight_kg == null ? null : Number(r.avg_weight_kg),
    rfid: r.rfid ?? null,
    zone: { id: r.zone_id, name: r.zone_name },
    owner: { id: r.owner_id, name: r.owner_name },
    photos: photos.map((p) => ({ id: p.id, url: p.url })),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Qui voit quoi :
 * - l'éleveur : ses animaux ;
 * - le vétérinaire : les animaux pour lesquels il a un accès en cours (RG1, créé au lot 3 par scan, soin ou invitation) ;
 * - l'agent : les animaux de sa zone ;
 * - l'autorité : tout.
 * Renvoie un fragment SQL sur l'alias `a` et ses paramètres (numérotés à partir de `start`).
 */
export function scopeSql(auth: AuthContext, zoneId: string | null, start: number): { sql: string; params: unknown[] } {
  switch (auth.role) {
    case 'eleveur':
      return { sql: `a.owner_id = $${start}`, params: [auth.userId] };
    case 'vet':
      return {
        sql: `EXISTS (SELECT 1 FROM access_grants g WHERE g.animal_id = a.id AND g.vet_id = $${start}
                      AND g.revoked_on IS NULL AND g.expires_on >= current_date)`,
        params: [auth.userId],
      };
    case 'agent':
      return zoneId ? { sql: `a.zone_id = $${start}`, params: [zoneId] } : { sql: 'false', params: [] };
    case 'autorite':
      return { sql: 'true', params: [] };
  }
}

export async function userZone(q: Queryable, userId: string): Promise<string | null> {
  return (await q.query('SELECT zone_id FROM users WHERE id = $1', [userId]))[0]?.zone_id ?? null;
}

export async function listAnimals(db: Db, auth: AuthContext, f: ListQuery) {
  const scope = scopeSql(auth, auth.role === 'agent' ? await userZone(db, auth.userId) : null, 1);
  const params: unknown[] = [...scope.params];
  const where: string[] = [scope.sql];
  const add = (sql: (n: number) => string, v: unknown) => {
    params.push(v);
    where.push(sql(params.length));
  };
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    add((n) => `(a.name ILIKE $${n} OR a.public_code ILIKE $${n} OR a.rfid ILIKE $${n} OR a.breed ILIKE $${n})`, like);
  }
  if (f.species) add((n) => `a.species = $${n}`, f.species);
  if (f.kind) add((n) => `a.kind = $${n}`, f.kind);
  if (f.status) add((n) => `a.status = $${n}`, f.status);
  if (f.zoneId) add((n) => `a.zone_id = $${n}`, f.zoneId);

  const sortCol = { name: 'a.name', created: 'a.created_at', born: 'a.born_on', species: 'a.species' }[f.sort];
  const dir = f.order === 'asc' ? 'ASC' : 'DESC';
  const whereSql = where.join(' AND ');

  const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animals a WHERE ${whereSql}`, params))[0]!.n;
  const rows = await db.query(
    `${BASE} WHERE ${whereSql} ORDER BY ${sortCol} ${dir} NULLS LAST, a.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`,
    params,
  );
  const photos = await photosFor(db, rows.map((r) => r.id));
  return {
    items: rows.map((r) => toAnimal(r, photos.get(r.id) ?? [])),
    total,
    page: f.page,
    limit: f.limit,
  };
}

export async function photosFor(q: Queryable, ids: string[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  if (!ids.length) return out;
  const rows = await q.query('SELECT * FROM animal_photos WHERE animal_id = ANY($1::uuid[]) ORDER BY created_at, id', [ids]);
  for (const p of rows) {
    const list = out.get(p.animal_id) ?? [];
    list.push(p);
    out.set(p.animal_id, list);
  }
  return out;
}

/** Charge un animal et le niveau d'accès de l'utilisateur ; 404 si l'animal n'existe pas OU n'est pas visible (on ne révèle rien). */
export async function loadVisible(q: Queryable, auth: AuthContext, id: string, lock = false): Promise<{ row: Row; level: AccessLevel }> {
  const rows = await q.query(`${BASE} WHERE a.id = $1${lock ? ' FOR UPDATE OF a' : ''}`, [id]);
  const row = rows[0];
  if (!row) throw notFound('Animal introuvable.');
  let level: AccessLevel | null = null;
  if (auth.role === 'autorite') level = 'autorite';
  else if (auth.role === 'eleveur') level = row.owner_id === auth.userId ? 'owner' : null;
  else if (auth.role === 'agent') level = row.zone_id === (await userZone(q, auth.userId)) ? 'agent' : null;
  else if (auth.role === 'vet') {
    const g = await q.query(
      'SELECT 1 FROM access_grants WHERE animal_id = $1 AND vet_id = $2 AND revoked_on IS NULL AND expires_on >= current_date',
      [id, auth.userId],
    );
    level = g.length ? 'vet' : null;
  }
  if (!level) throw notFound('Animal introuvable.');
  return { row, level };
}

export async function getAnimal(db: Db, auth: AuthContext, id: string) {
  const { row, level } = await loadVisible(db, auth, id);
  const photos = await photosFor(db, [id]);
  return { ...toAnimal(row, photos.get(id) ?? []), access: level };
}

/**
 * Scan d'un QR (code) ou d'une boucle RFID. Tout utilisateur connecté obtient une carte publique minimale,
 * pour savoir à qui appartient l'animal. Le dossier complet reste soumis aux droits d'accès (RG1, lot 3).
 */
export async function lookup(db: Db, auth: AuthContext, by: { code?: string; rfid?: string }) {
  const rows = by.code
    ? await db.query(`${BASE} WHERE a.public_code = $1`, [by.code])
    : await db.query(`${BASE} WHERE a.rfid = $1`, [by.rfid]);
  const r = rows[0];
  if (!r) throw notFound('Aucun animal ne correspond à ce code.', 'animal_not_found');
  let access: AccessLevel | null = null;
  try {
    access = (await loadVisible(db, auth, r.id)).level;
  } catch {
    access = null;
  }
  return {
    id: r.id,
    code: r.public_code,
    species: r.species,
    kind: r.kind,
    name: r.name,
    status: r.status,
    zone: r.zone_name,
    ownerName: r.owner_name,
    stolen: r.status === 'vole',
    access,
  };
}

async function assertZone(q: Queryable, zoneId: string): Promise<void> {
  if (!(await q.query('SELECT 1 FROM zones WHERE id = $1', [zoneId])).length) {
    throw invalid('Zone inconnue.', [{ path: ['zoneId'], message: 'Zone inconnue.' }]);
  }
}

async function nextCode(q: Queryable, species: Species): Promise<string> {
  const n = (await q.query<{ n: string }>("SELECT nextval('animal_code_seq')::text AS n"))[0]!.n;
  return `CI-${SPECIES_PREFIX[species]}-${n.padStart(5, '0')}`;
}

const isUnique = (e: any, constraintHint?: string) =>
  e?.code === '23505' && (!constraintHint || String(e?.constraint ?? e?.message ?? '').includes(constraintHint));

export async function createAnimal(db: Db, auth: AuthContext, b: CreateAnimalBody): Promise<AnimalDto> {
  const zoneId = b.zoneId ?? (await userZone(db, auth.userId));
  if (!zoneId) throw invalid('Indiquez la zone de l\'élevage (ou renseignez-la sur votre profil).', [{ path: ['zoneId'], message: 'Zone obligatoire.' }]);
  return db.tx(async (q) => {
    await assertZone(q, zoneId);
    const code = await nextCode(q, b.species);
    let id: string;
    try {
      id = (
        await q.query<{ id: string }>(
          `INSERT INTO animals (public_code, kind, species, breed, name, sex, born_on, owner_id, zone_id, qty, qty_initial, avg_weight_kg, rfid, photo_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13) RETURNING id`,
          [code, b.kind, b.species, b.breed ?? null, b.name, b.sex ?? null, b.bornOn ?? null, auth.userId, zoneId,
           b.kind === 'lot' ? b.qty : null, b.avgWeightKg ?? null, b.rfid ?? null, b.photoUrl ?? null],
        )
      )[0]!.id;
    } catch (e) {
      if (isUnique(e, 'rfid')) throw conflict('rfid_taken', 'Cette boucle RFID est déjà enregistrée sur une autre fiche.');
      throw e;
    }
    if (b.photoUrl) await q.query('INSERT INTO animal_photos (animal_id, url) VALUES ($1,$2)', [id, b.photoUrl]);
    // Première ligne de l'historique : entrée du lot, ou identification de l'animal.
    if (b.kind === 'lot') {
      await q.query(`INSERT INTO flows (animal_id, type, qty, recorded_by, note) VALUES ($1,'entree',$2,$3,'Création du lot')`, [id, b.qty, auth.userId]);
    } else if (b.rfid) {
      await q.query(`INSERT INTO flows (animal_id, type, recorded_by, note) VALUES ($1,'identification',$2,$3)`, [id, auth.userId, `Boucle ${b.rfid}`]);
    }
    await writeAudit(q, { actorId: auth.userId, animalId: id, action: 'animal.created', detail: { code, kind: b.kind, species: b.species } });
    const row = (await q.query(`${BASE} WHERE a.id = $1`, [id]))[0]!;
    const photos = await photosFor(q, [id]);
    return toAnimal(row, photos.get(id) ?? []);
  });
}

function assertOwnerMutable(row: Row, level: AccessLevel): void {
  if (level !== 'owner') throw forbidden('Seul le propriétaire peut modifier cette fiche.');
  // RG4 : un animal déclaré volé est bloqué
  if (row.status === 'vole') throw new AppError(423, 'animal_locked', 'Cet animal est déclaré volé : sa fiche est bloquée.');
}

export async function updateAnimal(db: Db, auth: AuthContext, id: string, b: UpdateAnimalBody): Promise<AnimalDto> {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, id, true);
    assertOwnerMutable(row, level);
    if (b.zoneId) await assertZone(q, b.zoneId);
    if (b.rfid !== undefined) {
      if (row.kind === 'lot') throw invalid("Un lot n'a pas de boucle RFID.", [{ path: ['rfid'], message: 'Interdit pour un lot.' }]);
      if (row.rfid && row.rfid !== b.rfid) throw conflict('rfid_immutable', 'La boucle RFID ne peut pas être remplacée une fois posée.');
    }
    if (b.sex !== undefined && b.sex !== null && row.kind === 'lot') {
      throw invalid("Le sexe ne s'applique pas à un lot.", [{ path: ['sex'], message: 'Interdit pour un lot.' }]);
    }
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (b.name !== undefined) set('name', b.name);
    if (b.breed !== undefined) set('breed', b.breed);
    if (b.sex !== undefined) set('sex', b.sex);
    if (b.bornOn !== undefined) set('born_on', b.bornOn);
    if (b.avgWeightKg !== undefined) set('avg_weight_kg', b.avgWeightKg);
    if (b.zoneId !== undefined) set('zone_id', b.zoneId);
    const newRfid = b.rfid !== undefined && !row.rfid;
    if (newRfid) set('rfid', b.rfid);
    try {
      await q.query(`UPDATE animals SET ${sets.join(', ')}${sets.length ? ',' : ''} updated_at = now() WHERE id = $1`, params);
    } catch (e) {
      if (isUnique(e, 'rfid')) throw conflict('rfid_taken', 'Cette boucle RFID est déjà enregistrée sur une autre fiche.');
      throw e;
    }
    if (newRfid) {
      await q.query(`INSERT INTO flows (animal_id, type, recorded_by, note) VALUES ($1,'identification',$2,$3)`, [id, auth.userId, `Boucle ${b.rfid}`]);
    }
    await writeAudit(q, { actorId: auth.userId, animalId: id, action: 'animal.updated', detail: { fields: Object.keys(b) } });
    const fresh = (await q.query(`${BASE} WHERE a.id = $1`, [id]))[0]!;
    return toAnimal(fresh, (await photosFor(q, [id])).get(id) ?? []);
  });
}

export async function addPhoto(db: Db, auth: AuthContext, id: string, url: string) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, id, true); // verrou : deux ajouts simultanés ne dépassent pas la limite
    assertOwnerMutable(row, level);
    const n = (await q.query<{ n: number }>('SELECT count(*)::int AS n FROM animal_photos WHERE animal_id = $1', [id]))[0]!.n;
    if (n >= MAX_PHOTOS) throw conflict('photo_limit', `Dix photos au maximum par fiche.`);
    const p = (await q.query('INSERT INTO animal_photos (animal_id, url) VALUES ($1,$2) RETURNING id, url', [id, url]))[0]!;
    if (!row.photo_url) await q.query('UPDATE animals SET photo_url = $2, updated_at = now() WHERE id = $1', [id, url]);
    await writeAudit(q, { actorId: auth.userId, animalId: id, action: 'animal.photo_added' });
    return { id: p.id as string, url: p.url as string };
  });
}

export async function removePhoto(db: Db, auth: AuthContext, id: string, photoId: string): Promise<void> {
  await db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, id, true);
    assertOwnerMutable(row, level);
    const del = await q.query('DELETE FROM animal_photos WHERE id = $1 AND animal_id = $2 RETURNING url', [photoId, id]);
    if (!del.length) throw notFound('Photo introuvable.');
    if (row.photo_url === del[0]!.url) {
      const next = (await q.query('SELECT url FROM animal_photos WHERE animal_id = $1 ORDER BY created_at, id LIMIT 1', [id]))[0];
      await q.query('UPDATE animals SET photo_url = $2, updated_at = now() WHERE id = $1', [id, next?.url ?? null]);
    }
    await writeAudit(q, { actorId: auth.userId, animalId: id, action: 'animal.photo_removed' });
  });
}
