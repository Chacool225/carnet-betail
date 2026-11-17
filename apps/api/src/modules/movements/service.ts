import type { Db, Queryable, Row } from '../../db/index.js';
import { AppError, conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { iso, writeAudit } from '../../lib/audit.js';
import { dateStr } from '../../lib/dates.js';
import { createAlert } from '../../lib/alerts.js';
import type { AuthContext } from '../../plugins/auth.js';
import { loadVisible, type AccessLevel } from '../animals/service.js';
import { withdrawalUntil } from '../health/service.js';
import type { MarketQuery, SellBody, SlaughterBody, TheftBody, TransferBody } from './schemas.js';

/** Propriétaire seulement ; un animal volé est bloqué (RG4) ; seul un animal actif peut bouger. */
function assertMovable(row: Row, level: AccessLevel): void {
  if (level !== 'owner') throw forbidden('Seul le propriétaire peut faire cela.');
  if (row.status === 'vole') throw new AppError(423, 'animal_locked', 'Cet animal est déclaré volé : sa fiche est bloquée.');
  if (row.status !== 'actif') throw conflict('animal_not_active', `Cet animal n'est plus actif (statut : ${row.status}).`);
}

/** RG6 : ni vente, ni abattage, ni mise en vente pendant un délai d'attente. */
async function assertNoWithdrawal(q: Queryable, animalId: string): Promise<void> {
  const until = await withdrawalUntil(q, animalId);
  if (until) throw conflict('withdrawal_active', `Délai d'attente avant vente en cours jusqu'au ${until}.`, { until });
}

async function clearListing(q: Queryable, animalId: string): Promise<void> {
  await q.query('UPDATE animals SET listed_at = NULL, listing_price = NULL WHERE id = $1', [animalId]);
}

const stateOf = async (q: Queryable, id: string) =>
  (await q.query('SELECT status, qty, owner_id, zone_id FROM animals WHERE id = $1', [id]))[0]!;

/** Change le propriétaire. L'historique de santé et les flux restent attachés à l'animal (RG3) ; les accès vétérinaires sont retirés. */
async function doTransfer(q: Queryable, auth: AuthContext, row: Row, toUserId: string, occurredOn: string | null): Promise<string> {
  const to = (await q.query('SELECT id, role, zone_id FROM users WHERE id = $1', [toUserId]))[0];
  if (!to || to.role !== 'eleveur') throw invalid("Le destinataire doit être un éleveur inscrit.", [{ path: ['toUserId'], message: 'Éleveur inconnu.' }]);
  if (to.id === auth.userId) throw invalid('Vous ne pouvez pas vous transférer un animal à vous-même.', [{ path: ['toUserId'], message: 'Destinataire identique.' }]);
  const t = await q.query<{ id: string }>(
    'INSERT INTO transfers (animal_id, from_user, to_user, occurred_on) VALUES ($1,$2,$3,COALESCE($4::date, current_date)) RETURNING id',
    [row.id, auth.userId, toUserId, occurredOn],
  );
  await q.query('UPDATE animals SET owner_id = $2, zone_id = COALESCE($3, zone_id), listed_at = NULL, listing_price = NULL, updated_at = now() WHERE id = $1', [
    row.id, toUserId, to.zone_id,
  ]);
  await q.query('UPDATE access_grants SET revoked_on = current_date WHERE animal_id = $1 AND revoked_on IS NULL', [row.id]);
  await writeAudit(q, { actorId: auth.userId, animalId: row.id, action: 'animal.transferred', detail: { from: auth.userId, to: toUserId } });
  return t[0]!.id;
}

export async function sell(db: Db, auth: AuthContext, animalId: string, b: SellBody) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    assertMovable(row, level);
    await assertNoWithdrawal(q, animalId);
    const stock: number | null = row.kind === 'lot' ? row.qty : null;
    const qty = row.kind === 'lot' ? (b.qty ?? stock!) : 1;
    if (row.kind === 'individual' && b.qty !== undefined && b.qty !== 1) throw invalid('Un animal seul compte pour 1.', [{ path: ['qty'], message: 'Doit valoir 1.' }]);
    if (stock !== null && qty > stock) throw conflict('qty_exceeds_stock', `Il ne reste que ${stock} animaux dans ce lot.`, { available: stock });
    const whole = stock === null || qty === stock;
    let counterpart = b.counterpart ?? null;
    let transferId: string | null = null;
    if (b.buyerId) {
      if (!whole) throw invalid("Une vente partielle d'un lot ne peut pas être transférée à un acheteur inscrit : indiquez seulement son nom.", [{ path: ['buyerId'], message: 'Interdit pour une vente partielle.' }]);
      counterpart = (await q.query('SELECT name FROM users WHERE id = $1', [b.buyerId]))[0]?.name ?? counterpart;
    }
    const note = b.price !== undefined ? `Prix : ${b.price} FCFA` : null;
    await q.query(
      `INSERT INTO flows (animal_id, type, qty, counterpart, note, occurred_on, recorded_by)
       VALUES ($1,'vente',$2,$3,$4,COALESCE($5::date, current_date),$6)`,
      [animalId, qty, counterpart, note, b.occurredOn ?? null, auth.userId],
    );
    if (b.buyerId) {
      transferId = await doTransfer(q, auth, row, b.buyerId, b.occurredOn ?? null);
    } else if (whole) {
      await q.query("UPDATE animals SET status = 'vendu', qty = CASE WHEN kind = 'lot' THEN 0 ELSE qty END, listed_at = NULL, listing_price = NULL, updated_at = now() WHERE id = $1", [animalId]);
    } else {
      await q.query('UPDATE animals SET qty = qty - $2, updated_at = now() WHERE id = $1', [animalId, qty]);
    }
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'animal.sold', detail: { qty, buyerId: b.buyerId ?? null, price: b.price ?? null } });
    const s = await stateOf(q, animalId);
    return { animalId, sold: qty, status: s.status as string, qty: (s.qty ?? null) as number | null, ownerId: s.owner_id as string, transferId };
  });
}

export async function slaughter(db: Db, auth: AuthContext, animalId: string, b: SlaughterBody) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    assertMovable(row, level);
    await assertNoWithdrawal(q, animalId);
    const stock: number | null = row.kind === 'lot' ? row.qty : null;
    const qty = row.kind === 'lot' ? (b.qty ?? stock!) : 1;
    if (row.kind === 'individual' && b.qty !== undefined && b.qty !== 1) throw invalid('Un animal seul compte pour 1.', [{ path: ['qty'], message: 'Doit valoir 1.' }]);
    if (stock !== null && qty > stock) throw conflict('qty_exceeds_stock', `Il ne reste que ${stock} animaux dans ce lot.`, { available: stock });
    const whole = stock === null || qty === stock;
    await q.query(
      `INSERT INTO flows (animal_id, type, qty, note, occurred_on, recorded_by) VALUES ($1,'abattage',$2,$3,COALESCE($4::date, current_date),$5)`,
      [animalId, qty, b.note ?? null, b.occurredOn ?? null, auth.userId],
    );
    if (whole) {
      await q.query("UPDATE animals SET status = 'abattu', qty = CASE WHEN kind = 'lot' THEN 0 ELSE qty END, listed_at = NULL, listing_price = NULL, updated_at = now() WHERE id = $1", [animalId]);
    } else {
      await q.query('UPDATE animals SET qty = qty - $2, updated_at = now() WHERE id = $1', [animalId, qty]);
    }
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'animal.slaughtered', detail: { qty } });
    const s = await stateOf(q, animalId);
    return { animalId, slaughtered: qty, status: s.status as string, qty: (s.qty ?? null) as number | null };
  });
}

export async function transfer(db: Db, auth: AuthContext, animalId: string, b: TransferBody) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    assertMovable(row, level);
    const transferId = await doTransfer(q, auth, row, b.toUserId, b.occurredOn ?? null);
    if (b.note) await q.query("INSERT INTO flows (animal_id, type, note, occurred_on, recorded_by) VALUES ($1,'identification',$2,COALESCE($3::date, current_date),$4)", [animalId, `Transfert : ${b.note}`, b.occurredOn ?? null, auth.userId]);
    const s = await stateOf(q, animalId);
    return { animalId, transferId, ownerId: s.owner_id as string };
  });
}

/** RG4 : la déclaration de vol bloque la fiche et alerte la zone. */
export async function declareTheft(db: Db, auth: AuthContext, animalId: string, b: TheftBody) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    assertMovable(row, level);
    await q.query("UPDATE animals SET status = 'vole', listed_at = NULL, listing_price = NULL, updated_at = now() WHERE id = $1", [animalId]);
    await q.query(
      `INSERT INTO flows (animal_id, type, qty, note, occurred_on, recorded_by) VALUES ($1,'vol',$2,$3,COALESCE($4::date, current_date),$5)`,
      [animalId, row.kind === 'lot' ? row.qty : null, b.note ?? null, b.occurredOn ?? null, auth.userId],
    );
    const alertId = await createAlert(q, {
      kind: 'vol', severity: 'haute', zoneId: row.zone_id, animalId,
      title: `Vol déclaré : ${row.public_code}`,
      why: `${row.species} (${row.kind === 'lot' ? `lot de ${row.qty}` : 'animal seul'}) déclaré volé dans la zone ${row.zone_name}.`,
    });
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'animal.theft_declared', detail: { alertId } });
    return { animalId, status: 'vole', alertId };
  });
}

/** L'animal est retrouvé : le propriétaire, un agent de sa zone ou l'autorité lèvent le blocage. */
export async function declareRecovery(db: Db, auth: AuthContext, animalId: string, note?: string) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    if (level === 'vet') throw forbidden();
    if (row.status !== 'vole') throw conflict('not_stolen', "Cet animal n'est pas déclaré volé.");
    await q.query("UPDATE animals SET status = 'actif', updated_at = now() WHERE id = $1", [animalId]);
    await q.query(
      "INSERT INTO flows (animal_id, type, qty, note, recorded_by) VALUES ($1,'entree',$2,$3,$4)",
      [animalId, row.kind === 'lot' ? row.qty : null, note ? `Retrouvé : ${note}` : 'Animal retrouvé', auth.userId],
    );
    await q.query(
      "UPDATE alerts SET handled_by = $2, handled_at = now() WHERE animal_id = $1 AND kind = 'vol' AND handled_at IS NULL",
      [animalId, auth.userId],
    );
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'animal.recovered' });
    return { animalId, status: 'actif' };
  });
}

export async function listFlows(db: Db, auth: AuthContext, animalId: string) {
  await loadVisible(db, auth, animalId);
  const rows = await db.query(
    `SELECT f.*, u.name AS recorder_name FROM flows f JOIN users u ON u.id = f.recorded_by
     WHERE f.animal_id = $1 ORDER BY f.occurred_on DESC, f.created_at DESC, f.id`,
    [animalId],
  );
  return {
    items: rows.map((r) => ({
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

// ---------- Marché ----------

export async function putOnMarket(db: Db, auth: AuthContext, animalId: string, price: number) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    assertMovable(row, level);
    await assertNoWithdrawal(q, animalId);
    if (row.kind === 'lot' && row.qty === 0) throw conflict('animal_not_active', 'Ce lot est vide.');
    await q.query('UPDATE animals SET listed_at = now(), listing_price = $2, updated_at = now() WHERE id = $1', [animalId, price]);
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'market.listed', detail: { price } });
    return { animalId, price, listed: true };
  });
}

export async function removeFromMarket(db: Db, auth: AuthContext, animalId: string): Promise<void> {
  await db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    if (level !== 'owner') throw forbidden('Seul le propriétaire peut faire cela.');
    if (!row.listed_at) throw notFound("Cet animal n'est pas en vente.", 'not_listed');
    await clearListing(q, animalId);
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'market.unlisted' });
  });
}

/** Annonces visibles de tous : seulement des animaux actifs, non volés, sans délai d'attente en cours. Pas de boucle RFID, pas de coordonnées. */
export async function market(db: Db, f: MarketQuery) {
  const params: unknown[] = [];
  const where = [
    'a.listed_at IS NOT NULL', "a.status = 'actif'",
    `NOT EXISTS (SELECT 1 FROM health_events e WHERE e.animal_id = a.id AND e.withdrawal_days > 0
                 AND e.done_on + e.withdrawal_days > current_date
                 AND NOT EXISTS (SELECT 1 FROM health_events c WHERE c.corrects_event_id = e.id))`,
  ];
  const add = (sql: (n: number) => string, v: unknown) => {
    params.push(v);
    where.push(sql(params.length));
  };
  if (f.q) add((n) => `(a.name ILIKE $${n} OR a.breed ILIKE $${n} OR a.public_code ILIKE $${n})`, `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (f.species) add((n) => `a.species = $${n}`, f.species);
  if (f.zoneId) add((n) => `a.zone_id = $${n}`, f.zoneId);
  if (f.minPrice !== undefined) add((n) => `a.listing_price >= $${n}`, f.minPrice);
  if (f.maxPrice !== undefined) add((n) => `a.listing_price <= $${n}`, f.maxPrice);
  const sortCol = f.sort === 'price' ? 'a.listing_price' : 'a.listed_at';
  const dir = f.order === 'asc' ? 'ASC' : 'DESC';
  const w = where.join(' AND ');
  const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animals a WHERE ${w}`, params))[0]!.n;
  const rows = await db.query(
    `SELECT a.*, z.name AS zone_name, o.name AS owner_name FROM animals a
     JOIN zones z ON z.id = a.zone_id JOIN users o ON o.id = a.owner_id
     WHERE ${w} ORDER BY ${sortCol} ${dir}, a.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`,
    params,
  );
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      code: r.public_code as string,
      species: r.species as string,
      kind: r.kind as string,
      name: r.name as string,
      breed: (r.breed ?? null) as string | null,
      sex: (r.sex ?? null) as string | null,
      qty: (r.qty ?? null) as number | null,
      avgWeightKg: r.avg_weight_kg == null ? null : Number(r.avg_weight_kg),
      price: Number(r.listing_price),
      listedAt: iso(r.listed_at),
      zone: r.zone_name as string,
      ownerName: r.owner_name as string,
      photoUrl: (r.photo_url ?? null) as string | null,
    })),
    total, page: f.page, limit: f.limit,
  };
}
