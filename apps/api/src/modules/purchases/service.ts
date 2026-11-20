import type { Db, Queryable, Row } from '../../db/index.js';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { iso, writeAudit } from '../../lib/audit.js';
import { dateStr } from '../../lib/dates.js';
import { notify } from '../../lib/notify.js';
import { escapeLike, pusher } from '../../lib/filters.js';
import { fcfa, tierOf, unitPriceFor, unitsLabel } from '../../lib/pricing.js';
import type { AuthContext } from '../../plugins/auth.js';
import { sellPartToBuyerTx, sellTx } from '../movements/service.js';
import { withdrawalUntil } from '../health/service.js';
import type { ProposalBody, RequestBody, RequestsQuery } from './schemas.js';

type Side = 'buyer' | 'seller';

async function loadListed(q: Queryable, animalId: string, lock = false): Promise<Row> {
  const r = (await q.query(
    `SELECT a.*, z.name AS zone_name, o.name AS owner_name FROM animals a
     JOIN zones z ON z.id = a.zone_id JOIN users o ON o.id = a.owner_id
     WHERE a.id = $1 AND a.listed_at IS NOT NULL AND a.status = 'actif'${lock ? ' FOR UPDATE OF a' : ''}`,
    [animalId],
  ))[0];
  if (!r) throw notFound("Cette annonce n'existe plus.", 'not_listed');
  if (await withdrawalUntil(q, animalId)) throw notFound("Cette annonce n'existe plus.", 'not_listed');
  return r;
}

/**
 * Nombre d'animaux encore disponibles pour une demande : la quantité mise en vente, moins ce qui est déjà réservé
 * par des accords conclus avec d'autres acheteurs (`exceptRequestId` écarte la demande en cours d'examen).
 */
async function available(q: Queryable, a: Row, exceptRequestId?: string): Promise<number> {
  const stock = Number(a.qty ?? 1);
  const listed = Math.min(Number(a.listing_qty ?? stock), stock);
  const reserved = Number((await q.query<{ n: string }>(
    `SELECT COALESCE(sum(agreed_qty), 0)::text AS n FROM purchase_requests
     WHERE animal_id = $1 AND status = 'acceptee' AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [a.id, exceptRequestId ?? null],
  ))[0]!.n);
  return Math.max(0, listed - reserved);
}

async function addMessage(
  q: Queryable, requestId: string, senderId: string | null, kind: 'text' | 'proposal' | 'recap' | 'system', body: string,
  extra: { qty?: number; unitPrice?: number; total?: number } = {},
): Promise<void> {
  await q.query(
    'INSERT INTO purchase_messages (request_id, sender_id, kind, body, qty, unit_price, total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [requestId, senderId, kind, body, extra.qty ?? null, extra.unitPrice ?? null, extra.total ?? null],
  );
}

/** Fiche publique d'une annonce : ce qu'un acheteur peut savoir sans être le propriétaire. Pas de boucle RFID, pas de téléphone. */
export async function publicSheet(db: Db, auth: AuthContext, animalId: string) {
  const r = await loadListed(db, animalId);
  const photos = await db.query('SELECT id, url FROM animal_photos WHERE animal_id = $1 ORDER BY created_at, id', [animalId]);
  const vaccines = await db.query(
    `SELECT e.label, e.done_on, e.vet_id IS NOT NULL AS signed FROM health_events e
     WHERE e.animal_id = $1 AND e.type = 'vaccin' AND NOT EXISTS (SELECT 1 FROM health_events c WHERE c.corrects_event_id = e.id)
     ORDER BY e.done_on DESC, e.created_at DESC LIMIT 15`,
    [animalId],
  );
  const open = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM cases WHERE animal_id = $1 AND status IN ('ouvert','suivi')", [animalId]))[0]!.n;
  const mine = (await db.query('SELECT id, status FROM purchase_requests WHERE animal_id = $1 AND buyer_id = $2 AND status IN (\'en_attente\',\'acceptee\')', [animalId, auth.userId]))[0];
  const t = tierOf(r);
  return {
    id: r.id as string, code: r.public_code as string, species: r.species as string, kind: r.kind as string, name: r.name as string,
    breed: (r.breed ?? null) as string | null, sex: (r.sex ?? null) as string | null, bornOn: dateStr(r.born_on),
    qty: (r.qty ?? null) as number | null, avgWeightKg: r.avg_weight_kg == null ? null : Number(r.avg_weight_kg),
    /** Prix à l'unité ; `bulkMinQty` / `bulkPrice` : prix réduit à partir de ce nombre d'animaux. */
    price: t.price, bulkMinQty: t.bulkMinQty, bulkPrice: t.bulkPrice,
    listingQty: Number(r.listing_qty ?? r.qty ?? 1), availableQty: await available(db, r),
    listedAt: iso(r.listed_at), zone: r.zone_name as string, ownerName: r.owner_name as string,
    photos: photos.map((p) => ({ id: p.id as string, url: p.url as string })),
    health: {
      vaccines: vaccines.map((v) => ({ label: v.label as string, doneOn: dateStr(v.done_on)!, signedByVet: v.signed as boolean })),
      openCases: open,
    },
    isMine: r.owner_id === auth.userId,
    myRequest: mine ? { id: mine.id as string, status: mine.status as string } : null,
  };
}

export async function createRequest(db: Db, auth: AuthContext, animalId: string, b: RequestBody) {
  if (auth.role !== 'particulier' && auth.role !== 'eleveur') throw forbidden("Seuls les particuliers et les éleveurs peuvent demander à acheter.");
  return db.tx(async (q) => {
    const a = await loadListed(q, animalId, true);
    if (a.owner_id === auth.userId) throw conflict('own_animal', 'Vous ne pouvez pas acheter votre propre animal.');
    const buyer = (await q.query('SELECT name FROM users WHERE id = $1', [auth.userId]))[0]!;
    const avail = await available(q, a);
    if (avail < 1) throw conflict('sold_out', "Il n'y a plus d'animaux disponibles pour cette annonce.", { available: 0 });
    const qty = b.qty ?? (a.kind === 'lot' ? avail : 1);
    if (qty > avail) throw conflict('qty_exceeds_available', `Il n'en reste que ${avail} à vendre.`, { available: avail });
    const unit = b.offeredPrice ?? unitPriceFor(tierOf(a), qty);
    let id: string;
    try {
      id = (await q.query<{ id: string }>(
        `INSERT INTO purchase_requests (animal_id, buyer_id, seller_id, message, offered_price, qty, buyer_qty, buyer_unit_price)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7) RETURNING id`,
        [animalId, auth.userId, a.owner_id, b.message || null, b.offeredPrice ?? null, qty, unit],
      ))[0]!.id;
    } catch (e: any) {
      if (e?.code === '23505') throw conflict('request_exists', "Vous avez déjà une demande en cours pour cet animal.");
      throw e;
    }
    if (b.message) await addMessage(q, id, auth.userId, 'text', b.message);
    await addMessage(q, id, auth.userId, 'proposal', `Je propose : ${unitsLabel(a.species, qty)} à ${fcfa(unit)} l'unité, soit ${fcfa(unit * qty)}.`, { qty, unitPrice: unit, total: unit * qty });
    await notify(q, {
      userId: a.owner_id, kind: 'purchase_request', link: `/demandes?ouvrir=${id}`,
      title: `Demande d'achat : ${a.name}`,
      body: `${buyer.name} souhaite acheter ${unitsLabel(a.species, qty)} à ${fcfa(unit)} l'unité (${fcfa(unit * qty)}).`,
    });
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'market.request_sent', detail: { requestId: id, qty, offeredPrice: b.offeredPrice ?? null } });
    return { id, status: 'en_attente' as const, qty, unitPrice: unit, total: unit * qty };
  });
}

const SELECT = `SELECT r.*, a.name AS animal_name, a.public_code, a.species, a.kind, a.qty AS stock_qty, a.status AS animal_status,
                       a.listing_price, a.bulk_min_qty, a.bulk_price,
                       b.name AS buyer_name, b.phone AS buyer_phone, s.name AS seller_name, s.phone AS seller_phone,
                       bp.profession, bp.org_kind, bp.org_name, bp.contact_name, bp.contact_phone, bp.locality
                FROM purchase_requests r JOIN animals a ON a.id = r.animal_id
                JOIN users b ON b.id = r.buyer_id JOIN users s ON s.id = r.seller_id
                LEFT JOIN buyer_profiles bp ON bp.user_id = r.buyer_id`;

const proposal = (qty: unknown, unit: unknown) => (qty == null || unit == null ? null : { qty: Number(qty), unitPrice: Number(unit) });

/** Les coordonnées de l'autre partie n'apparaissent qu'une fois l'accord conclu (ou la vente faite). */
function dto(r: Row, side: Side) {
  const shared = r.status === 'acceptee' || r.status === 'conclue';
  const other = side === 'buyer'
    ? { name: r.seller_name as string, phone: shared ? (r.seller_phone as string) : null }
    : { name: r.buyer_name as string, phone: shared ? (r.buyer_phone as string) : null };
  const agreedQty = r.agreed_qty == null ? null : Number(r.agreed_qty);
  const agreedPrice = r.agreed_price == null ? null : Number(r.agreed_price);
  const buyerProposal = proposal(r.buyer_qty, r.buyer_unit_price);
  const sellerProposal = proposal(r.seller_qty, r.seller_unit_price);
  const hasProfile = r.profession != null || r.org_name != null || r.locality != null;
  return {
    id: r.id as string,
    status: r.status as string,
    message: (r.message ?? null) as string | null,
    qty: Number(r.qty),
    offeredPrice: r.offered_price == null ? null : Number(r.offered_price),
    agreedPrice,
    agreedQty,
    agreedTotal: agreedQty != null && agreedPrice != null ? agreedQty * agreedPrice : null,
    listingPrice: r.listing_price == null ? null : Number(r.listing_price),
    bulkMinQty: r.bulk_min_qty == null ? null : Number(r.bulk_min_qty),
    bulkPrice: r.bulk_price == null ? null : Number(r.bulk_price),
    mine: side === 'buyer' ? buyerProposal : sellerProposal,
    theirs: side === 'buyer' ? sellerProposal : buyerProposal,
    sellerNote: (r.seller_note ?? null) as string | null,
    createdAt: iso(r.created_at)!, decidedAt: iso(r.decided_at), completedAt: iso(r.completed_at),
    animal: { id: r.animal_id as string, code: r.public_code as string, name: r.animal_name as string, species: r.species as string, kind: r.kind as string, qty: (r.stock_qty ?? null) as number | null },
    other,
    // Le vendeur voit qui est l'acheteur (profession, organisation, localité) ; le numéro du responsable suit la règle des coordonnées.
    buyerProfile: side === 'seller' && hasProfile
      ? {
          profession: (r.profession ?? null) as string | null, orgKind: (r.org_kind ?? null) as string | null, orgName: (r.org_name ?? null) as string | null,
          contactName: (r.contact_name ?? null) as string | null, contactPhone: shared ? ((r.contact_phone ?? null) as string | null) : null,
          locality: (r.locality ?? null) as string | null,
        }
      : null,
  };
}

async function list(db: Db, auth: AuthContext, f: RequestsQuery, side: Side) {
  const params: unknown[] = [auth.userId];
  const p = pusher(params);
  const where = [side === 'buyer' ? 'r.buyer_id = $1' : 'r.seller_id = $1'];
  if (f.status) where.push(`r.status = $${p(f.status)}`);
  if (f.from) where.push(`r.created_at::date >= $${p(f.from)}::date`);
  if (f.to) where.push(`r.created_at::date <= $${p(f.to)}::date`);
  if (f.q) {
    const n = p(`%${escapeLike(f.q)}%`);
    where.push(`(a.name ILIKE $${n} OR a.public_code ILIKE $${n} OR b.name ILIKE $${n} OR s.name ILIKE $${n} OR bp.org_name ILIKE $${n})`);
  }
  const w = where.join(' AND ');
  const dir = f.order === 'asc' ? 'ASC' : 'DESC';
  const total = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM purchase_requests r JOIN animals a ON a.id = r.animal_id JOIN users b ON b.id = r.buyer_id JOIN users s ON s.id = r.seller_id
     LEFT JOIN buyer_profiles bp ON bp.user_id = r.buyer_id WHERE ${w}`, params))[0]!.n;
  const rows = await db.query(`${SELECT} WHERE ${w} ORDER BY r.created_at ${dir}, r.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  return { items: rows.map((r) => dto(r, side)), total, page: f.page, limit: f.limit };
}

export const listSent = (db: Db, auth: AuthContext, f: RequestsQuery) => list(db, auth, f, 'buyer');
export const listReceived = (db: Db, auth: AuthContext, f: RequestsQuery) => list(db, auth, f, 'seller');

async function loadRequest(q: Queryable, id: string, lock = true): Promise<Row> {
  const r = (await q.query(`${SELECT} WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`, [id]))[0];
  if (!r) throw notFound('Demande introuvable.');
  return r;
}

function sideOf(r: Row, auth: AuthContext): Side {
  if (r.buyer_id === auth.userId) return 'buyer';
  if (r.seller_id === auth.userId) return 'seller';
  throw notFound('Demande introuvable.');
}

/** Détail d'une demande pour la fenêtre de négociation : la demande, plus ce qui reste disponible à la vente. */
export async function detail(db: Queryable, auth: AuthContext, id: string) {
  const r = await loadRequest(db, id, false);
  const side = sideOf(r, auth);
  const a = r.status === 'en_attente'
    ? await loadListed(db, r.animal_id).catch(() => null)
    : null;
  return { ...dto(r, side), side, availableQty: a ? await available(db, a, id) : null };
}

export async function listMessages(db: Queryable, auth: AuthContext, id: string) {
  const r = await loadRequest(db, id, false);
  sideOf(r, auth);
  const rows = await db.query(
    `SELECT m.*, u.name AS sender_name FROM purchase_messages m LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.request_id = $1 ORDER BY m.created_at, m.id LIMIT 300`, [id]);
  return {
    items: rows.map((m) => ({
      id: m.id as string, kind: m.kind as string, body: m.body as string,
      senderId: (m.sender_id ?? null) as string | null, senderName: (m.sender_name ?? null) as string | null, mine: m.sender_id === auth.userId,
      qty: m.qty == null ? null : Number(m.qty), unitPrice: m.unit_price == null ? null : Number(m.unit_price), total: m.total == null ? null : Number(m.total),
      createdAt: iso(m.created_at)!,
    })),
  };
}

/** Une notification de message par demande tant que l'autre partie ne l'a pas lue, pour ne pas la noyer. */
async function notifyChat(q: Queryable, userId: string, requestId: string, from: string, title: string, body: string): Promise<void> {
  const link = `/demandes?ouvrir=${requestId}`;
  const pending = await q.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'purchase_message' AND link = $2 AND read_at IS NULL", [userId, link]);
  if (!pending.length) await notify(q, { userId, kind: 'purchase_message', link, title, body: `${from} : ${body.slice(0, 120)}` });
}

export async function postMessage(db: Db, auth: AuthContext, id: string, body: string) {
  return db.tx(async (q) => {
    const r = await loadRequest(q, id);
    const side = sideOf(r, auth);
    if (r.status !== 'en_attente' && r.status !== 'acceptee') throw conflict('request_closed', `Cette demande est « ${r.status} » : la conversation est fermée.`);
    await addMessage(q, id, auth.userId, 'text', body);
    const other = side === 'buyer' ? r.seller_id : r.buyer_id;
    await notifyChat(q, other, id, side === 'buyer' ? r.buyer_name : r.seller_name, `Message : ${r.animal_name}`, body);
    return listMessages(q, auth, id);
  });
}

/** Les deux propositions sont identiques : l'accord est conclu, les quantités sont réservées et un récapitulatif est posté dans la conversation. */
async function concludeAgreement(q: Queryable, r: Row, actorId: string): Promise<void> {
  const qty = Number(r.buyer_qty), unit = Number(r.buyer_unit_price), total = qty * unit;
  const t = tierOf(r);
  await q.query("UPDATE purchase_requests SET status = 'acceptee', agreed_qty = $2, agreed_price = $3, qty = $2, decided_at = now() WHERE id = $1", [r.id, qty, unit]);
  const reduced = t.bulkMinQty != null && t.bulkPrice === unit && qty >= t.bulkMinQty ? ` (prix réduit dès ${t.bulkMinQty})` : '';
  await addMessage(q, r.id, null, 'recap',
    `Accord conclu\nAnimal : ${r.animal_name} (${r.public_code})\nQuantité : ${unitsLabel(r.species, qty)}\nPrix à l'unité : ${fcfa(unit)}${reduced}\nTotal : ${fcfa(total)}\nVous pouvez maintenant vous contacter pour convenir de la remise.`,
    { qty, unitPrice: unit, total });
  for (const [uid, who] of [[r.buyer_id, r.seller_name], [r.seller_id, r.buyer_name]] as const) {
    await notify(q, {
      userId: uid, kind: 'purchase_accepted', link: `/demandes?ouvrir=${r.id}`, title: `Accord conclu : ${r.animal_name}`,
      body: `${unitsLabel(r.species, qty)} × ${fcfa(unit)} = ${fcfa(total)} avec ${who}.`,
    });
  }
  await writeAudit(q, { actorId, animalId: r.animal_id, action: 'market.agreement', detail: { requestId: r.id, qty, unitPrice: unit, total } });
}

/** Chaque partie saisit quantité et prix à l'unité. Quand les deux saisies sont identiques, l'accord est conclu. */
export async function propose(db: Db, auth: AuthContext, id: string, b: ProposalBody) {
  return db.tx(async (q) => {
    const r = await loadRequest(q, id);
    const side = sideOf(r, auth);
    if (r.status !== 'en_attente') throw conflict('request_closed', r.status === 'acceptee' ? "L'accord est déjà conclu." : `Cette demande est déjà « ${r.status} ».`);
    const a = await loadListed(q, r.animal_id, true).catch(() => { throw conflict('not_listed', "L'animal n'est plus en vente."); });
    if (r.kind === 'individual' && b.qty !== 1) throw invalid('Un animal seul compte pour 1.', [{ path: ['qty'], message: 'Doit valoir 1.' }]);
    const avail = await available(q, a, id);
    if (b.qty > avail) throw conflict('qty_exceeds_available', `Il n'en reste que ${avail} à vendre.`, { available: avail });
    const cols = side === 'buyer' ? ['buyer_qty', 'buyer_unit_price'] : ['seller_qty', 'seller_unit_price'];
    await q.query(`UPDATE purchase_requests SET ${cols[0]} = $2, ${cols[1]} = $3, qty = $2 WHERE id = $1`, [id, b.qty, b.unitPrice]);
    const total = b.qty * b.unitPrice;
    const who = side === 'buyer' ? 'acheteur' : 'vendeur';
    await addMessage(q, id, auth.userId, 'proposal', `Proposition (${who}) : ${unitsLabel(r.species, b.qty)} à ${fcfa(b.unitPrice)} l'unité, soit ${fcfa(total)}.`, { qty: b.qty, unitPrice: b.unitPrice, total });
    const fresh = await loadRequest(q, id);
    const match = fresh.buyer_qty != null && fresh.seller_qty != null
      && Number(fresh.buyer_qty) === Number(fresh.seller_qty) && Number(fresh.buyer_unit_price) === Number(fresh.seller_unit_price);
    if (match) {
      await concludeAgreement(q, fresh, auth.userId);
    } else {
      const other = side === 'buyer' ? r.seller_id : r.buyer_id;
      await notifyChat(q, other, id, side === 'buyer' ? r.buyer_name : r.seller_name, `Nouvelle proposition : ${r.animal_name}`, `${unitsLabel(r.species, b.qty)} à ${fcfa(b.unitPrice)} l'unité`);
    }
    return { ...dto(await loadRequest(q, id), side), side, agreed: match };
  });
}

/** Le vendeur accepte tel quel ce que l'acheteur propose : cela revient à saisir les mêmes quantité et prix. */
export async function decide(db: Db, auth: AuthContext, id: string, action: 'accept' | 'refuse', note?: string) {
  return db.tx(async (q) => {
    const r = await loadRequest(q, id);
    if (r.seller_id !== auth.userId) throw notFound('Demande introuvable.');
    if (r.status !== 'en_attente') throw conflict('request_closed', `Cette demande est déjà « ${r.status} ».`);
    if (action === 'accept') {
      const a = await loadListed(q, r.animal_id, true).catch(() => { throw conflict('not_listed', "L'animal n'est plus en vente : remettez-le en vente avant d'accepter."); });
      const qty = Number(r.buyer_qty ?? r.qty ?? 1);
      const unit = r.buyer_unit_price != null ? Number(r.buyer_unit_price) : unitPriceFor(tierOf(a), qty);
      const avail = await available(q, a, id);
      if (qty > avail) throw conflict('qty_exceeds_available', `Il n'en reste que ${avail} à vendre : proposez une autre quantité.`, { available: avail });
      await q.query("UPDATE purchase_requests SET buyer_qty = $2, buyer_unit_price = $3, seller_qty = $2, seller_unit_price = $3, seller_note = $4 WHERE id = $1", [id, qty, unit, note || null]);
      if (note) await addMessage(q, id, auth.userId, 'text', note);
      await concludeAgreement(q, await loadRequest(q, id), auth.userId);
    } else {
      await q.query("UPDATE purchase_requests SET status = 'refusee', seller_note = $2, decided_at = now() WHERE id = $1", [id, note || null]);
      if (note) await addMessage(q, id, auth.userId, 'text', note);
      await addMessage(q, id, null, 'system', `${r.seller_name} a refusé la demande.`);
      await notify(q, { userId: r.buyer_id, kind: 'purchase_refused', link: `/demandes?ouvrir=${id}`, title: `Demande refusée : ${r.animal_name}`, body: note || `${r.seller_name} n'a pas donné suite.` });
      await writeAudit(q, { actorId: auth.userId, animalId: r.animal_id, action: 'market.request_refused', detail: { requestId: id } });
    }
    return dto(await loadRequest(q, id), 'seller');
  });
}

export async function cancel(db: Db, auth: AuthContext, id: string) {
  return db.tx(async (q) => {
    const r = await loadRequest(q, id);
    if (r.buyer_id !== auth.userId) throw notFound('Demande introuvable.');
    if (r.status !== 'en_attente' && r.status !== 'acceptee') throw conflict('request_closed', `Cette demande est déjà « ${r.status} ».`);
    await q.query("UPDATE purchase_requests SET status = 'annulee', decided_at = now() WHERE id = $1", [id]);
    await addMessage(q, id, null, 'system', `${r.buyer_name} a retiré sa demande.`);
    await notify(q, { userId: r.seller_id, kind: 'purchase_cancelled', link: `/demandes?ouvrir=${id}`, title: `Demande annulée : ${r.animal_name}`, body: `${r.buyer_name} a retiré sa demande.` });
    await writeAudit(q, { actorId: auth.userId, animalId: r.animal_id, action: 'market.request_cancelled', detail: { requestId: id } });
    return dto(await loadRequest(q, id), 'buyer');
  });
}

/**
 * L'éleveur confirme que les animaux ont été remis : la vente est enregistrée.
 * Vente de tout l'effectif : la fiche passe au compte de l'acheteur. Vente d'une partie d'un lot : un nouveau lot est créé chez l'acheteur.
 */
export async function complete(db: Db, auth: AuthContext, id: string, occurredOn?: string) {
  return db.tx(async (q) => {
    const r = await loadRequest(q, id);
    if (r.seller_id !== auth.userId) throw notFound('Demande introuvable.');
    if (r.status !== 'acceptee') throw conflict('request_not_accepted', "Acceptez d'abord la demande avant de conclure la vente.");
    const qty = Number(r.agreed_qty ?? 1);
    const total = qty * Number(r.agreed_price ?? 0);
    const stock = r.stock_qty == null ? null : Number(r.stock_qty);
    const whole = r.kind === 'individual' || qty === stock;
    const sale = whole
      ? await sellTx(q, auth, r.animal_id, { buyerId: r.buyer_id, price: r.agreed_price == null ? undefined : total, occurredOn })
      : await sellPartToBuyerTx(q, auth, r.animal_id, r.buyer_id, qty, total, occurredOn);
    const newAnimalId = 'newAnimalId' in sale ? (sale.newAnimalId as string) : null;
    await q.query("UPDATE purchase_requests SET status = 'conclue', completed_at = now() WHERE id = $1", [id]);
    await addMessage(q, id, null, 'system', `Vente enregistrée : ${unitsLabel(r.species, qty)} pour ${fcfa(total)}.`, { qty, total });
    // Les autres demandes ne sont refusées que s'il ne reste plus rien en vente.
    const left = (await q.query('SELECT listed_at IS NOT NULL AS listed, status FROM animals WHERE id = $1', [r.animal_id]))[0]!;
    if (!left.listed || left.status !== 'actif') {
      const others = await q.query(
        "UPDATE purchase_requests SET status = 'refusee', seller_note = 'Animal vendu à un autre acheteur.', decided_at = now() WHERE animal_id = $1 AND id <> $2 AND status IN ('en_attente','acceptee') RETURNING id, buyer_id",
        [r.animal_id, id],
      );
      for (const o of others) {
        await addMessage(q, o.id as string, null, 'system', 'Les animaux ont été vendus à un autre acheteur.');
        await notify(q, { userId: o.buyer_id as string, kind: 'purchase_refused', link: `/demandes?ouvrir=${o.id}`, title: `Animal vendu : ${r.animal_name}`, body: 'Cet animal a été vendu à un autre acheteur.' });
      }
    }
    await notify(q, {
      userId: r.buyer_id, kind: 'purchase_done', link: `/animaux/${newAnimalId ?? r.animal_id}`, title: `Achat finalisé : ${r.animal_name}`,
      body: newAnimalId ? `Un lot de ${unitsLabel(r.species, qty)} avec son carnet de santé est maintenant sur votre compte.` : 'La fiche et son carnet de santé sont maintenant sur votre compte.',
    });
    await writeAudit(q, { actorId: auth.userId, animalId: r.animal_id, action: 'market.sold_to_buyer', detail: { requestId: id, qty, unitPrice: r.agreed_price == null ? null : Number(r.agreed_price), price: total } });
    return { ...dto(await loadRequest(q, id), 'seller'), transferId: ('transferId' in sale ? sale.transferId : null) as string | null, newAnimalId };
  });
}
