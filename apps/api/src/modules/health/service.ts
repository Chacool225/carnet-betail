import type { Db, Queryable, Row } from '../../db/index.js';
import { AppError, conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { iso, writeAudit } from '../../lib/audit.js';
import { dateStr, todayStr } from '../../lib/dates.js';
import { isNotifiable } from '../../lib/diseases.js';
import { MORTALITY_ALERT_MIN_STOCK, MORTALITY_ALERT_RATIO, checkOutbreak, createAlert } from '../../lib/alerts.js';
import type { AuthContext } from '../../plugins/auth.js';
import { loadVisible, scopeSql, userZone, type AccessLevel } from '../animals/service.js';
import { renewIfAny } from '../access/service.js';
import type { CasesQuery, CreateCaseBody, CreateEventBody, EventsQuery, MortalityBody, UpdateCaseBody } from './schemas.js';
import { escapeLike, pusher } from '../../lib/filters.js';

/** Seuls le propriétaire et un vétérinaire ayant accès écrivent dans le dossier. */
function assertCanWrite(row: Row, level: AccessLevel): void {
  if (level !== 'owner' && level !== 'vet') throw forbidden("Vous n'avez pas le droit d'écrire dans ce dossier.");
  if (row.status === 'vole') throw new AppError(423, 'animal_locked', 'Cet animal est déclaré volé : sa fiche est bloquée.'); // RG4
}

// ---------- Actes de santé (RG2 : ajout seul) ----------

export const EVENT_SELECT = `
  SELECT e.*, (e.done_on + COALESCE(e.withdrawal_days, 0)) AS withdrawal_until,
         r.name AS recorder_name, r.role AS recorder_role, v.name AS vet_name,
         c.id AS corrected_by
  FROM health_events e
  JOIN users r ON r.id = e.recorded_by
  LEFT JOIN users v ON v.id = e.vet_id
  LEFT JOIN health_events c ON c.corrects_event_id = e.id`;

export function toEvent(r: Row) {
  return {
    id: r.id as string,
    animalId: r.animal_id as string,
    type: r.type as string,
    label: r.label as string,
    doneOn: dateStr(r.done_on),
    nextDueOn: dateStr(r.next_due_on),
    withdrawalDays: (r.withdrawal_days ?? null) as number | null,
    withdrawalUntil: r.withdrawal_days ? dateStr(r.withdrawal_until) : null,
    note: (r.note ?? null) as string | null,
    recordedBy: { id: r.recorded_by as string, name: r.recorder_name as string, role: r.recorder_role as string },
    vet: r.vet_id ? { id: r.vet_id as string, name: r.vet_name as string } : null,
    signedByVet: !!r.vet_id,
    correctsEventId: (r.corrects_event_id ?? null) as string | null,
    correctedBy: (r.corrected_by ?? null) as string | null,
    createdAt: iso(r.created_at),
  };
}

export async function createEvent(db: Db, auth: AuthContext, animalId: string, b: CreateEventBody) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    assertCanWrite(row, level);
    if (b.correctsEventId) {
      const target = (await q.query('SELECT animal_id, recorded_by FROM health_events WHERE id = $1', [b.correctsEventId]))[0];
      if (!target || target.animal_id !== animalId) throw notFound("L'acte à corriger est introuvable sur cet animal.", 'event_not_found');
      if (level !== 'owner' && target.recorded_by !== auth.userId) throw forbidden('Seul son auteur ou le propriétaire peut corriger cet acte.');
      const done = await q.query('SELECT 1 FROM health_events WHERE corrects_event_id = $1', [b.correctsEventId]);
      if (done.length) throw conflict('already_corrected', 'Cet acte a déjà été corrigé : corrigez la version la plus récente.');
    }
    const vetId = level === 'vet' ? auth.userId : null; // un acte posé par un vétérinaire est signé par lui
    const id = (
      await q.query<{ id: string }>(
        `INSERT INTO health_events (animal_id, type, label, done_on, next_due_on, withdrawal_days, vet_id, recorded_by, note, corrects_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [animalId, b.type, b.label, b.doneOn, b.nextDueOn ?? null, b.withdrawalDays ?? null, vetId, auth.userId, b.note ?? null, b.correctsEventId ?? null],
      )
    )[0]!.id;
    if (level === 'vet') await renewIfAny(q, animalId, auth.userId); // RG1 : un soin prolonge l'accès de 30 jours
    await writeAudit(q, { actorId: auth.userId, animalId, action: b.correctsEventId ? 'health.corrected' : 'health.recorded', detail: { eventId: id, type: b.type } });
    return toEvent((await q.query(`${EVENT_SELECT} WHERE e.id = $1`, [id]))[0]!);
  });
}

export async function listEvents(db: Db, auth: AuthContext, animalId: string, f: EventsQuery) {
  await loadVisible(db, auth, animalId);
  const params: unknown[] = [animalId];
  const where = ['e.animal_id = $1'];
  const p = pusher(params);
  if (f.type) where.push(`e.type = $${p(f.type)}`);
  if (f.from) where.push(`e.done_on >= $${p(f.from)}::date`);
  if (f.to) where.push(`e.done_on <= $${p(f.to)}::date`);
  if (f.signed !== undefined) where.push(f.signed ? 'e.vet_id IS NOT NULL' : 'e.vet_id IS NULL');
  if (f.q) {
    const n = p(`%${escapeLike(f.q)}%`);
    where.push(`(e.label ILIKE $${n} OR e.note ILIKE $${n} OR r.name ILIKE $${n} OR v.name ILIKE $${n})`);
  }
  const dir = f.order === 'asc' ? 'ASC' : 'DESC';
  const rows = await db.query(`${EVENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.done_on ${dir}, e.created_at ${dir}, e.id`, params);
  return { items: rows.map(toEvent) };
}

/**
 * RG6 : date jusqu'à laquelle l'animal ne peut pas être vendu (null = aucun délai en cours).
 * Les actes corrigés sont ignorés : c'est leur correction qui compte. Utilisée par le lot 4 (vente et abattage).
 */
export async function withdrawalUntil(q: Queryable, animalId: string): Promise<string | null> {
  const r = await q.query(
    `SELECT max(e.done_on + e.withdrawal_days) AS until
     FROM health_events e
     WHERE e.animal_id = $1 AND e.withdrawal_days > 0
       AND NOT EXISTS (SELECT 1 FROM health_events c WHERE c.corrects_event_id = e.id)`,
    [animalId],
  );
  const until = dateStr(r[0]?.until);
  return until && until > todayStr() ? until : null;
}

/** Résumé pour la fiche : délai d'attente en cours, prochains rappels, dernier acte. */
export async function healthSummary(db: Db, auth: AuthContext, animalId: string) {
  await loadVisible(db, auth, animalId);
  const until = await withdrawalUntil(db, animalId);
  const rows = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (e.label) e.* FROM health_events e
       WHERE e.animal_id = $1 AND NOT EXISTS (SELECT 1 FROM health_events c WHERE c.corrects_event_id = e.id)
       ORDER BY e.label, e.done_on DESC, e.created_at DESC
     ) x WHERE x.next_due_on IS NOT NULL ORDER BY x.next_due_on`,
    [animalId],
  );
  const last = (
    await db.query(`${EVENT_SELECT} WHERE e.animal_id = $1 ORDER BY e.done_on DESC, e.created_at DESC LIMIT 1`, [animalId])
  )[0];
  const today = todayStr();
  return {
    withdrawalUntil: until,
    canSell: until === null,
    upcoming: rows.map((r) => ({
      label: r.label as string,
      type: r.type as string,
      nextDueOn: dateStr(r.next_due_on),
      overdue: dateStr(r.next_due_on)! < today,
    })),
    lastEvent: last ? toEvent(last) : null,
  };
}

/** Calendrier de rappels sur les animaux visibles : en retard ou à faire dans les `days` prochains jours. */
export async function reminders(db: Db, auth: AuthContext, days: number) {
  const scope = scopeSql(auth, auth.role === 'agent' ? await userZone(db, auth.userId) : null, 1);
  const rows = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (e.animal_id, e.label)
              e.id, e.animal_id, e.type, e.label, e.next_due_on, a.name AS animal_name, a.public_code
       FROM health_events e JOIN animals a ON a.id = e.animal_id
       WHERE ${scope.sql} AND a.status = 'actif'
         AND NOT EXISTS (SELECT 1 FROM health_events c WHERE c.corrects_event_id = e.id)
       ORDER BY e.animal_id, e.label, e.done_on DESC, e.created_at DESC
     ) x
     WHERE x.next_due_on IS NOT NULL AND x.next_due_on <= current_date + $${scope.params.length + 1}::int
     ORDER BY x.next_due_on, x.animal_name`,
    [...scope.params, days],
  );
  const today = todayStr();
  return {
    items: rows.map((r) => ({
      eventId: r.id as string,
      animal: { id: r.animal_id as string, code: r.public_code as string, name: r.animal_name as string },
      type: r.type as string,
      label: r.label as string,
      dueOn: dateStr(r.next_due_on),
      overdue: dateStr(r.next_due_on)! < today,
    })),
  };
}

// ---------- Mortalité (RG5 : un effectif ne passe jamais sous zéro) ----------

/** À appeler dans une transaction où la ligne de l'animal est verrouillée. */
async function applyMortality(
  q: Queryable, auth: AuthContext, row: Row, qty: number, o: { cause?: string; occurredOn?: string; note?: string },
) {
  if (row.status !== 'actif') throw conflict('animal_not_active', "Cet animal n'est plus actif : on ne peut plus y déclarer de mortalité.");
  let remaining: number | null = null;
  if (row.kind === 'lot') {
    if (qty > row.qty) throw conflict('qty_exceeds_stock', `Il ne reste que ${row.qty} animaux dans ce lot.`, { available: row.qty });
    remaining = row.qty - qty;
    if (row.qty >= MORTALITY_ALERT_MIN_STOCK && qty / row.qty >= MORTALITY_ALERT_RATIO) {
      await createAlert(q, {
        kind: 'anomalie', severity: 'moyenne', zoneId: row.zone_id, animalId: row.id,
        title: `Forte mortalité dans un lot de ${row.species}`,
        why: `${qty} morts sur ${row.qty} en une déclaration.`,
      });
    }
    await q.query('UPDATE animals SET qty = $2, status = $3, updated_at = now() WHERE id = $1', [row.id, remaining, remaining === 0 ? 'decede' : 'actif']);
  } else {
    if (qty !== 1) throw invalid('Un animal seul compte pour 1.', [{ path: ['qty'], message: 'Doit valoir 1.' }]);
    await q.query("UPDATE animals SET status = 'decede', updated_at = now() WHERE id = $1", [row.id]);
  }
  const note = [o.cause ? `Cause : ${o.cause}` : null, o.note].filter(Boolean).join(' — ') || null;
  await q.query(
    `INSERT INTO flows (animal_id, type, qty, note, occurred_on, recorded_by) VALUES ($1,'mortalite',$2,$3,COALESCE($4::date, current_date),$5)`,
    [row.id, qty, note, o.occurredOn ?? null, auth.userId],
  );
  await writeAudit(q, { actorId: auth.userId, animalId: row.id, action: 'animal.mortality', detail: { qty, remaining } });
  return { remaining };
}

export async function declareMortality(db: Db, auth: AuthContext, animalId: string, b: MortalityBody) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    assertCanWrite(row, level);
    if (b.occurredOn && b.occurredOn > todayStr()) throw invalid('La date est dans le futur.', [{ path: ['occurredOn'], message: 'Date future.' }]);
    const { remaining } = await applyMortality(q, auth, row, b.qty, b);
    const fresh = (await q.query('SELECT qty, status FROM animals WHERE id = $1', [animalId]))[0]!;
    return { animalId, deaths: b.qty, qty: (fresh.qty ?? null) as number | null, status: fresh.status as string, remaining };
  });
}

// ---------- Signalements de maladie ----------

export const toCase = (r: Row) => ({
  id: r.id as string,
  animalId: r.animal_id as string,
  diseases: r.diseases as string[],
  notifiable: (r.diseases as string[]).some(isNotifiable), // RG7 : le lot 4 en tire une alerte
  affectedCount: r.affected_count as number,
  severity: r.severity as string,
  symptoms: r.symptoms as string[],
  deaths: r.deaths as number,
  status: r.status as string,
  note: (r.note ?? null) as string | null,
  openedOn: dateStr(r.opened_on),
  closedOn: dateStr(r.closed_on),
  openedBy: { id: r.opened_by as string, name: r.opener_name as string },
});

export const CASE_SELECT = `SELECT c.*, u.name AS opener_name FROM cases c JOIN users u ON u.id = c.opened_by`;

export async function createCase(db: Db, auth: AuthContext, animalId: string, b: CreateCaseBody) {
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    assertCanWrite(row, level);
    if (row.kind === 'individual' && b.affectedCount !== 1) {
      throw invalid('Un animal seul compte pour 1 malade.', [{ path: ['affectedCount'], message: 'Doit valoir 1.' }]);
    }
    if (row.kind === 'lot' && b.affectedCount > row.qty) {
      throw conflict('qty_exceeds_stock', `Il ne reste que ${row.qty} animaux dans ce lot.`, { available: row.qty });
    }
    if (b.deaths > b.affectedCount) throw invalid('Les morts ne peuvent pas dépasser les malades.', [{ path: ['deaths'], message: 'Trop élevé.' }]);
    const id = (
      await q.query<{ id: string }>(
        `INSERT INTO cases (animal_id, diseases, affected_count, severity, symptoms, deaths, note, opened_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [animalId, b.diseases, b.affectedCount, b.severity, b.symptoms, b.deaths, b.note ?? null, auth.userId],
      )
    )[0]!.id;
    if (b.deaths > 0) await applyMortality(q, auth, row, b.deaths, { cause: b.diseases.join(', ') });
    if (level === 'vet') await renewIfAny(q, animalId, auth.userId);
    if (b.diseases.some(isNotifiable)) {
      // RG7 : une maladie à déclaration obligatoire déclenche une alerte haute visible de l'autorité
      await createAlert(q, {
        kind: 'sanitaire', severity: 'haute', zoneId: row.zone_id, animalId,
        title: `Maladie à déclaration obligatoire : ${b.diseases.filter(isNotifiable).join(', ')}`,
        why: `${b.affectedCount} animal(aux) touché(s) dans la zone ${row.zone_name}.`,
      });
    }
    for (const d of b.diseases) await checkOutbreak(q, row.zone_id, row.zone_name, d);
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'case.opened', detail: { caseId: id, diseases: b.diseases, deaths: b.deaths } });
    return toCase((await q.query(`${CASE_SELECT} WHERE c.id = $1`, [id]))[0]!);
  });
}

export async function listCases(db: Db, auth: AuthContext, animalId: string, f: CasesQuery) {
  await loadVisible(db, auth, animalId);
  const params: unknown[] = [animalId];
  const where = ['c.animal_id = $1'];
  const p = pusher(params);
  if (f.status) where.push(`c.status = $${p(f.status)}`);
  if (f.from) where.push(`c.opened_on >= $${p(f.from)}::date`);
  if (f.to) where.push(`c.opened_on <= $${p(f.to)}::date`);
  if (f.q) {
    const n = p(`%${escapeLike(f.q)}%`);
    where.push(`(array_to_string(c.diseases, ' ') ILIKE $${n} OR array_to_string(c.symptoms, ' ') ILIKE $${n} OR c.note ILIKE $${n})`);
  }
  const dir = f.order === 'asc' ? 'ASC' : 'DESC';
  const rows = await db.query(`${CASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.opened_on ${dir}, c.created_at ${dir}`, params);
  return { items: rows.map(toCase) };
}

const NEXT_STATUS: Record<string, string[]> = { ouvert: ['suivi', 'gueri', 'clos'], suivi: ['gueri', 'clos'], gueri: ['clos'], clos: [] };

export async function updateCase(db: Db, auth: AuthContext, caseId: string, b: UpdateCaseBody) {
  return db.tx(async (q) => {
    const c = (await q.query('SELECT * FROM cases WHERE id = $1 FOR UPDATE', [caseId]))[0];
    if (!c) throw notFound('Signalement introuvable.');
    const { row, level } = await loadVisible(q, auth, c.animal_id); // 404 si l'animal n'est pas visible
    assertCanWrite(row, level);
    if (b.status && !NEXT_STATUS[c.status]!.includes(b.status)) {
      throw conflict('invalid_transition', `Un signalement « ${c.status} » ne peut pas passer à « ${b.status} ».`);
    }
    const closing = b.status === 'gueri' || b.status === 'clos';
    await q.query(
      `UPDATE cases SET status = COALESCE($2, status), note = COALESCE($3, note),
              closed_on = CASE WHEN $4::boolean AND closed_on IS NULL THEN current_date ELSE closed_on END
       WHERE id = $1`,
      [caseId, b.status ?? null, b.note ?? null, closing],
    );
    await writeAudit(q, { actorId: auth.userId, animalId: c.animal_id, action: 'case.updated', detail: { caseId, status: b.status } });
    return toCase((await q.query(`${CASE_SELECT} WHERE c.id = $1`, [caseId]))[0]!);
  });
}
