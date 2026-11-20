/**
 * Jeu de données de démonstration COMPLET (en plus de `seed.ts`, qui reste le jeu minimal).
 *
 * Il raconte environ quatre mois de vie du carnet : chaque type d'événement possible apparaît au moins une fois,
 * avec son historique, ses dates réparties dans le passé, et la ligne de journal d'audit que l'application écrirait.
 * Tout est fictif. Les dates sont relatives à aujourd'hui (« il y a 9 jours »), donc les rappels et les délais d'attente
 * restent cohérents quel que soit le jour où le jeu est chargé.
 *
 *   pnpm --filter @carnet/api seed:complet                 charge le jeu (sans doublon : ne fait rien s'il est déjà là)
 *   pnpm --filter @carnet/api seed:complet -- --reset --yes   efface TOUTES les données puis recharge
 *
 * Le README de ce dossier (SEED-COMPLET.md) raconte l'histoire et dit qui a fait quoi.
 */
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { createDb, type Queryable } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { hashSecret } from '../lib/passwords.js';
import { describeAction } from '../lib/history.js';
import { fcfa, unitsLabel } from '../lib/pricing.js';
import { createReminderNotifications } from '../jobs/reminders.js';
import { DEMO_ANIMALS, DEMO_PASSWORD, DEMO_USERS, ZONES, seed } from './seed.js';

// ---------------------------------------------------------------------------------------------------------------------
// Identifiants fixes : le jeu est reconnaissable et rejouable.
// ---------------------------------------------------------------------------------------------------------------------
const uid = (kind: string, n: number) => `5eed0000-0000-4000-8000-${kind}${String(n).padStart(10, '0')}`;

const Z = {
  abidjan: ZONES[0]!.id, bouake: ZONES[1]!.id, korhogo: ZONES[2]!.id, ferke: ZONES[3]!.id,
  yakro: ZONES[4]!.id, daloa: ZONES[5]!.id, man: ZONES[6]!.id, sanpedro: ZONES[7]!.id,
};

/** Comptes : les cinq du seed minimal, plus onze nouveaux. */
export const U = {
  awa: DEMO_USERS[0].id, seydou: DEMO_USERS[1].id, yao: DEMO_USERS[2].id, bamba: DEMO_USERS[3].id, autorite: DEMO_USERS[4].id,
  moussa: uid('01', 1), fatou: uid('01', 2), kouame: uid('01', 3),
  sylla: uid('01', 4), coulibaly: uid('01', 5),
  soro: uid('01', 6),
  resto: uid('01', 7), koffi: uid('01', 8), sahel: uid('01', 9),
};

const A = (n: number) => uid('02', n);
export const ANIMAL = {
  kouadio: DEMO_ANIMALS[0].id, tachete: DEMO_ANIMALS[1].id, bande1: DEMO_ANIMALS[2].id,
  noiraud: A(4), zebu: A(5), taurillon: A(6), blanchette: A(7), chevres: A(8), poulesPonte: A(9), pintades: A(10),
  porcs: A(11), lapins: A(12), tilapia: A(13), tabaski: A(14), fatim: A(15), belier: A(16), bleuet: A(17), lotResto: A(18),
};

const MARKER_USER = U.moussa;
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export interface SeedReport { skipped: boolean; counts: Record<string, number> }

// ---------------------------------------------------------------------------------------------------------------------
// Temps : tout est relatif à « maintenant », jamais dans le futur.
// ---------------------------------------------------------------------------------------------------------------------
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function resetAll(q: Queryable): Promise<void> {
  const rows = await q.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'");
  if (rows.length) await q.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await q.query('ALTER SEQUENCE animal_code_seq RESTART WITH 1000');
}

type Id = string;
interface St {
  id: Id; kind: 'individual' | 'lot'; species: string; qty: number | null; qtyInitial: number | null; status: string; owner: Id; zone: Id;
  listing: { at: Date; price: number; qty: number; bulkMin: number | null; bulkPrice: number | null } | null; updated: Date; avgWeight: number | null;
}

export async function seedComplet(q: Queryable, now: Date = new Date()): Promise<SeedReport> {
  await seed(q); // comptes et animaux de base (idempotent)
  const already = await q.query('SELECT 1 FROM users WHERE id = $1', [MARKER_USER]);
  if (already.length) return { skipped: true, counts: {} };
  // Base déjà utilisée (ventes, signalements, journal… saisis à la main) : le jeu ne peut pas s'y mêler sans créer des incohérences.
  for (const t of ['flows', 'transfers', 'cases', 'alerts', 'purchase_requests', 'audit_log']) {
    if ((await q.query(`SELECT 1 FROM ${t} LIMIT 1`)).length) {
      throw new Error(`La base contient déjà des données saisies à la main (table ${t}). Pour charger le jeu complet, repartez de zéro : pnpm --filter @carnet/api seed:complet -- --reset --yes`);
    }
  }

  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  /** Instant « il y a `ago` jours à `h` heures `m` minutes » ; jamais après maintenant. */
  const T = (ago: number, h = 9, m = 0): Date => new Date(Math.min(startOfToday - ago * DAY + (h * 60 + m) * 60_000, now.getTime()));
  /** Jour AAAA-MM-JJ « il y a `ago` jours » (négatif = dans le futur, pour les échéances). */
  const D = (ago: number): string => new Date(startOfToday - ago * DAY).toISOString().slice(0, 10);

  const pwd = await hashSecret(DEMO_PASSWORD);
  const audits: { at: Date; actor: Id | null; animal: Id | null; action: string; detail: unknown }[] = [];
  const audit = (at: Date, actor: Id | null, animal: Id | null, action: string, detail?: unknown) => { audits.push({ at, actor, animal, action, detail: detail ?? null }); };
  const states = new Map<Id, St>();
  const names = new Map<Id, string>();
  const roles = new Map<Id, string>();
  const counts = { notifications: 0 };

  // -------------------------------------------------------------------------------------------------------------------
  // 1. Comptes
  // -------------------------------------------------------------------------------------------------------------------
  // Les cinq comptes du seed minimal sont plus anciens que « maintenant » : on repousse leur création.
  const oldCreation: [Id, number][] = [[U.awa, 135], [U.seydou, 132], [U.yao, 140], [U.bamba, 138], [U.autorite, 150]];
  for (const [id, ago] of oldCreation) await q.query('UPDATE users SET created_at = $2, updated_at = $2 WHERE id = $1', [id, T(ago)]);
  for (const u of DEMO_USERS) { names.set(u.id, u.name); roles.set(u.id, u.role); }

  const newUsers: { id: Id; role: string; name: string; phone: string; email: string | null; pin: string | null; zone: Id; ago: number }[] = [
    { id: U.moussa, role: 'eleveur', name: 'Moussa Ouattara', phone: '0734567890', email: null, pin: '1111', zone: Z.korhogo, ago: 125 },
    { id: U.fatou, role: 'eleveur', name: 'Fatou Diallo', phone: '0745678901', email: 'fatou@demo.ci', pin: '2222', zone: Z.bouake, ago: 110 },
    { id: U.kouame, role: 'eleveur', name: "Kouamé N'Guessan", phone: '0756789012', email: null, pin: null, zone: Z.daloa, ago: 100 },
    { id: U.sylla, role: 'vet', name: 'Dr Aminata Sylla', phone: '0502030405', email: 'sylla@demo.ci', pin: null, zone: Z.bouake, ago: 118 },
    { id: U.coulibaly, role: 'vet', name: 'Dr Ibrahim Coulibaly', phone: '0503040506', email: null, pin: null, zone: Z.korhogo, ago: 3 },
    { id: U.soro, role: 'agent', name: 'Agent Soro', phone: '0103040506', email: null, pin: null, zone: Z.korhogo, ago: 120 },
    { id: U.resto, role: 'particulier', name: 'Restaurant Le Baobab', phone: '0788888801', email: null, pin: null, zone: Z.abidjan, ago: 40 },
    { id: U.koffi, role: 'particulier', name: 'Koffi Yao', phone: '0788888802', email: null, pin: null, zone: Z.korhogo, ago: 35 },
    { id: U.sahel, role: 'particulier', name: 'Boucherie Sahel', phone: '0788888803', email: null, pin: null, zone: Z.bouake, ago: 30 },
  ];
  for (const u of newUsers) {
    await q.query(
      `INSERT INTO users (id, role, name, phone, email, password_hash, pin_hash, zone_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [u.id, u.role, u.name, u.phone, u.email, pwd, u.pin ? await hashSecret(u.pin) : null, u.zone, T(u.ago)],
    );
    names.set(u.id, u.name); roles.set(u.id, u.role);
  }
  // Vétérinaires : Sylla est vérifiée, Coulibaly attend la vérification de l'autorité (écran « Vétérinaires à vérifier »).
  await q.query("INSERT INTO vets (user_id, order_number, clinic, verified) VALUES ($1,'ONV-CI-0057','Cabinet vétérinaire Sylla', true)", [U.sylla]);
  await q.query("INSERT INTO vets (user_id, order_number, clinic, verified) VALUES ($1,'ONV-CI-0088','Clinique du Nord', false)", [U.coulibaly]);

  // Profils d'acheteur (profession ou organisation représentée).
  const buyerProfiles: [Id, string | null, string | null, string | null, string | null, string | null, string | null][] = [
    [U.resto, 'Restaurateur', 'restaurant', 'Le Baobab', 'Mme Koné Adjoua', '0711223344', 'Cocody, Abidjan'],
    [U.koffi, 'Éleveur amateur', null, null, null, null, 'Korhogo'],
    [U.sahel, 'Boucher', 'boucherie', 'Boucherie Sahel', 'M. Diarra', '0799887766', 'Bouaké'],
  ];
  for (const b of buyerProfiles) {
    await q.query('INSERT INTO buyer_profiles (user_id, profession, org_kind, org_name, contact_name, contact_phone, locality, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [...b, T(30)]);
  }

  // Journal de compte : inscription, connexions, changements de mot de passe ou de code, verrouillage, vérification.
  let seedRand = 7;
  const rnd = () => { seedRand = (seedRand * 1103515245 + 12345) & 0x7fffffff; return seedRand / 0x7fffffff; };
  const devices = ['Mozilla/5.0 (Linux; Android 13; Tecno Spark 10) Chrome/124', 'Mozilla/5.0 (Linux; Android 12; Itel A58) Chrome/120', 'Mozilla/5.0 (Windows NT 10.0) Chrome/126', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/605'];
  const pinUsers = new Set<Id>([U.awa, U.seydou, U.moussa, U.fatou]);
  const created = new Map<Id, number>([...oldCreation, ...newUsers.map((u): [Id, number] => [u.id, u.ago])]);
  for (const [id, ago] of created) {
    audit(T(ago, 8, 12), id, null, 'auth.register', { role: roles.get(id) });
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const when = T(Math.max(0, Math.floor(ago * (1 - (i + 1) / (n + 1)))), 6 + Math.floor(rnd() * 12), Math.floor(rnd() * 60));
      audit(when, id, null, 'auth.login', { method: pinUsers.has(id) && rnd() > 0.5 ? 'pin' : 'password', device: devices[Math.floor(rnd() * devices.length)] });
    }
  }
  audit(T(60, 18, 2), U.awa, null, 'auth.password_changed');
  audit(T(70, 7, 40), U.moussa, null, 'auth.pin_changed');
  // Trop d'essais : le compte de Seydou est bloqué 15 minutes, puis il se reconnecte.
  audit(T(33, 6, 5), U.seydou, null, 'auth.locked', { minutes: 15 });
  audit(T(33, 6, 31), U.seydou, null, 'auth.login', { method: 'password', device: devices[0] });
  // Mot de passe oublié par SMS : demande, puis réinitialisation avec le code.
  audit(T(45, 19, 3), U.fatou, null, 'auth.password_reset_requested');
  audit(T(45, 19, 6), U.fatou, null, 'auth.password_reset');
  await q.query('INSERT INTO password_resets (user_id, code_hash, attempts, expires_at, used_at, created_at) VALUES ($1,$2,1,$3,$4,$5)', [U.fatou, await hashSecret('482916'), T(45, 19, 18), T(45, 19, 6), T(45, 19, 3)]);
  audit(T(100, 10, 0), U.autorite, null, 'vet.verified', { vetId: U.sylla });
  audit(T(138, 10, 0), U.autorite, null, 'vet.verified', { vetId: U.yao });

  // -------------------------------------------------------------------------------------------------------------------
  // Outils : animaux, santé, mouvements, signalements, alertes
  // -------------------------------------------------------------------------------------------------------------------
  const touch = (s: St, at: Date) => { if (at > s.updated) s.updated = at; };
  const st = (id: Id): St => { const s = states.get(id); if (!s) throw new Error(`animal inconnu ${id}`); return s; };

  // Les trois animaux du seed minimal entrent dans le suivi d'état (ils existent déjà en base).
  for (const a of DEMO_ANIMALS) {
    const r = (await q.query('SELECT owner_id, zone_id FROM animals WHERE id = $1', [a.id]))[0]!;
    states.set(a.id, { id: a.id, kind: a.kind, species: a.species, qty: a.qty, qtyInitial: a.qty, status: 'actif', owner: r.owner_id, zone: r.zone_id, listing: null, updated: T(0), avgWeight: null });
    names.set(a.id, a.name);
  }
  const baseCreated: [Id, number][] = [[ANIMAL.kouadio, 128], [ANIMAL.tachete, 125], [ANIMAL.bande1, 112]];
  for (const [id, ago] of baseCreated) { await q.query('UPDATE animals SET created_at = $2 WHERE id = $1', [id, T(ago)]); st(id).updated = T(ago); }

  interface NewAnimal { id: Id; code: string; kind: 'individual' | 'lot'; species: string; breed?: string | null; name: string; sex?: 'M' | 'F' | null; bornOn?: string | null; owner: Id; zone: Id; qty?: number; rfid?: string | null; ago: number; avgWeight?: number }
  const animal = async (a: NewAnimal) => {
    await q.query(
      `INSERT INTO animals (id, public_code, kind, species, breed, name, sex, born_on, owner_id, zone_id, qty, qty_initial, avg_weight_kg, rfid, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$14)`,
      [a.id, a.code, a.kind, a.species, a.breed ?? null, a.name, a.sex ?? null, a.bornOn ?? null, a.owner, a.zone, a.kind === 'lot' ? a.qty! : null, a.avgWeight ?? null, a.rfid ?? null, T(a.ago)],
    );
    states.set(a.id, { id: a.id, kind: a.kind, species: a.species, qty: a.kind === 'lot' ? a.qty! : null, qtyInitial: a.kind === 'lot' ? a.qty! : null, status: 'actif', owner: a.owner, zone: a.zone, listing: null, updated: T(a.ago), avgWeight: a.avgWeight ?? null });
    names.set(a.id, a.name);
    // Première ligne de l'historique : entrée du lot, ou identification de l'animal (comme à la création dans l'application).
    if (a.kind === 'lot') await flow(a.id, 'entree', a.ago, { qty: a.qty!, note: 'Création du lot', by: a.owner, hour: 8, skipState: true });
    else if (a.rfid) await flow(a.id, 'identification', a.ago, { note: `Boucle ${a.rfid}`, by: a.owner, hour: 8, skipState: true });
    audit(T(a.ago, 8, 5), a.owner, a.id, 'animal.created', { code: a.code, kind: a.kind, species: a.species });
  };

  interface FlowOpts { qty?: number; counterpart?: string; weight?: number; note?: string; by: Id; hour?: number; related?: Id; skipState?: boolean }
  const flow = async (animalId: Id, type: string, ago: number, o: FlowOpts) => {
    const at = T(ago, o.hour ?? 10, Math.floor(rnd() * 50));
    await q.query(
      'INSERT INTO flows (animal_id, type, qty, counterpart, weight_kg, related_animal_id, note, occurred_on, recorded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [animalId, type, o.qty ?? null, o.counterpart ?? null, o.weight ?? null, o.related ?? null, o.note ?? null, D(ago), o.by, at],
    );
    touch(st(animalId), at);
    return at;
  };

  const health = async (animalId: Id, h: { type: 'vaccin' | 'soin' | 'controle'; label: string; ago: number; next?: number; wd?: number; vet?: Id; by?: Id; note?: string; corrects?: Id; hour?: number }): Promise<Id> => {
    const s = st(animalId);
    const by = h.by ?? h.vet ?? s.owner;
    const id = uid('03', ++healthSeq);
    const at = T(h.ago, h.hour ?? 11, Math.floor(rnd() * 50));
    await q.query(
      `INSERT INTO health_events (id, animal_id, type, label, done_on, next_due_on, withdrawal_days, vet_id, recorded_by, note, corrects_event_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, animalId, h.type, h.label, D(h.ago), h.next === undefined ? null : D(-h.next), h.wd ?? null, h.vet ?? null, by, h.note ?? null, h.corrects ?? null, at],
    );
    audit(at, by, animalId, h.corrects ? 'health.corrected' : 'health.recorded', { eventId: id, type: h.type });
    touch(s, at);
    return id;
  };
  let healthSeq = 0;

  const kase = async (animalId: Id, c: { diseases: string[]; n: number; sev: 'legere' | 'moyenne' | 'grave'; symptoms: string[]; note?: string; deaths?: number; status?: string; ago: number; by?: Id; closedAgo?: number }): Promise<Id> => {
    const s = st(animalId);
    const id = uid('04', ++caseSeq);
    const by = c.by ?? s.owner;
    const at = T(c.ago, 12, 10);
    await q.query(
      `INSERT INTO cases (id, animal_id, diseases, affected_count, severity, symptoms, note, deaths, status, opened_on, closed_on, opened_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, animalId, c.diseases, c.n, c.sev, c.symptoms, c.note ?? null, c.deaths ?? 0, c.status ?? 'ouvert', D(c.ago), c.closedAgo === undefined ? null : D(c.closedAgo), by, at],
    );
    audit(at, by, animalId, 'case.opened', { caseId: id, diseases: c.diseases, deaths: c.deaths ?? 0 });
    touch(s, at);
    return id;
  };
  let caseSeq = 0;
  const caseUpdate = async (caseId: Id, animalId: Id, status: string, ago: number, by: Id) => {
    const closed = status === 'gueri' || status === 'clos';
    await q.query('UPDATE cases SET status = $2, closed_on = $3 WHERE id = $1', [caseId, status, closed ? D(ago) : null]);
    const at = T(ago, 15, 20);
    audit(at, by, animalId, 'case.updated', { caseId, status });
    touch(st(animalId), at);
  };

  const alert = async (a: { kind: 'vol' | 'sanitaire' | 'anomalie'; severity: 'haute' | 'moyenne' | 'basse'; zone: Id; animal?: Id; title: string; why: string; ago: number; handledBy?: Id; handledAgo?: number }): Promise<Id> => {
    const id = uid('06', ++alertSeq);
    await q.query(
      'INSERT INTO alerts (id, kind, severity, zone_id, animal_id, title, why, created_on, handled_by, handled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, a.kind, a.severity, a.zone, a.animal ?? null, a.title, a.why, D(a.ago), a.handledBy ?? null, a.handledBy ? T(a.handledAgo ?? a.ago, 14, 30) : null],
    );
    // Une alerte prise en charge par un agent ou l'autorité laisse une trace ; celle fermée par un « retrouvé » n'en laisse pas (voir movements).
    if (a.handledBy && roles.get(a.handledBy) !== 'eleveur') audit(T(a.handledAgo ?? a.ago, 14, 30), a.handledBy, a.animal ?? null, 'alert.handled', { alertId: id });
    return id;
  };
  let alertSeq = 0;

  const grant = async (animalId: Id, vet: Id, source: 'scan' | 'soin' | 'invitation' | 'enregistrement', ago: number, o: { expiresIn?: number; revokedAgo?: number; by?: Id } = {}) => {
    const expiresAgo = ago - 30 + (o.expiresIn ?? 0);
    await q.query(
      'INSERT INTO access_grants (animal_id, vet_id, source, granted_on, expires_on, revoked_on) VALUES ($1,$2,$3,$4,$5,$6)',
      [animalId, vet, source, D(ago), D(expiresAgo), o.revokedAgo === undefined ? null : D(o.revokedAgo)],
    );
    const actor = source === 'invitation' ? (o.by ?? st(animalId).owner) : vet;
    audit(T(ago, 9, 30), actor, animalId, 'access.granted', source === 'invitation' ? { source, vetId: vet } : { source });
    if (o.revokedAgo !== undefined) audit(T(o.revokedAgo, 17, 0), st(animalId).owner, animalId, 'access.revoked', { vetId: vet });
  };

  const photo = async (animalId: Id, ago: number, n: number, o: { removed?: boolean } = {}) => {
    const id = uid('07', n);
    const url = `/photos/${id}/file`;
    const s = st(animalId);
    await q.query('INSERT INTO animal_photos (id, animal_id, url, created_at) VALUES ($1,$2,$3,$4)', [id, animalId, url, T(ago, 16, 0)]);
    await q.query("INSERT INTO photo_files (photo_id, content_type, data_b64) VALUES ($1,'image/png',$2)", [id, PNG_1PX]);
    audit(T(ago, 16, 0), s.owner, animalId, 'animal.photo_added', { upload: true });
    if (o.removed) {
      await q.query('DELETE FROM animal_photos WHERE id = $1', [id]);
      audit(T(ago - 1, 10, 0), s.owner, animalId, 'animal.photo_removed');
    } else {
      await q.query('UPDATE animals SET photo_url = COALESCE(photo_url, $2) WHERE id = $1', [animalId, url]);
    }
  };

  const list = (animalId: Id, ago: number, price: number, o: { qty?: number; bulkMin?: number; bulkPrice?: number } = {}) => {
    const s = st(animalId);
    const qty = o.qty ?? (s.kind === 'lot' ? s.qty! : 1);
    s.listing = { at: T(ago, 10, 0), price, qty, bulkMin: o.bulkMin ?? null, bulkPrice: o.bulkPrice ?? null };
    audit(T(ago, 10, 0), s.owner, animalId, 'market.listed', { price, qty, bulkMinQty: o.bulkMin ?? null, bulkPrice: o.bulkPrice ?? null });
    touch(s, T(ago, 10, 0));
  };
  const unlist = (animalId: Id, ago: number) => {
    const s = st(animalId);
    s.listing = null;
    audit(T(ago, 10, 0), s.owner, animalId, 'market.unlisted');
    touch(s, T(ago, 10, 0));
  };

  const mortality = async (animalId: Id, qty: number, ago: number, cause: string) => {
    const s = st(animalId);
    const before = s.qty;
    let remaining: number | null = null;
    if (s.kind === 'lot') { remaining = s.qty! - qty; s.qty = remaining; if (remaining === 0) s.status = 'decede'; } else s.status = 'decede';
    s.listing = null;
    await flow(animalId, 'mortalite', ago, { qty, note: `Cause : ${cause}`, by: s.owner, hour: 7 });
    audit(T(ago, 7, 30), s.owner, animalId, 'animal.mortality', { qty, remaining });
    // Même règle que l'application : au moins 20 % d'un lot de 10 têtes ou plus en une seule déclaration = anomalie.
    if (s.kind === 'lot' && before! >= 10 && qty / before! >= 0.2) {
      await alert({ kind: 'anomalie', severity: 'moyenne', zone: s.zone, animal: animalId, title: `Forte mortalité dans un lot de ${s.species}`, why: `${qty} morts sur ${before} en une déclaration.`, ago });
    }
  };

  const sell = async (animalId: Id, ago: number, o: { qty?: number; counterpart: string; price: number }) => {
    const s = st(animalId);
    const qty = o.qty ?? (s.kind === 'lot' ? s.qty! : 1);
    await flow(animalId, 'vente', ago, { qty, counterpart: o.counterpart, note: `Prix : ${o.price} FCFA`, by: s.owner });
    if (s.kind === 'lot' && qty < s.qty!) s.qty = s.qty! - qty; else { s.status = 'vendu'; if (s.kind === 'lot') s.qty = 0; s.listing = null; }
    audit(T(ago, 10, 40), s.owner, animalId, 'animal.sold', { qty, buyerId: null, price: o.price });
  };

  const slaughter = async (animalId: Id, ago: number, note: string, qty?: number) => {
    const s = st(animalId);
    const n = qty ?? (s.kind === 'lot' ? s.qty! : 1);
    await flow(animalId, 'abattage', ago, { qty: n, note, by: s.owner });
    if (s.kind === 'lot' && n < s.qty!) s.qty = s.qty! - n; else { s.status = 'abattu'; if (s.kind === 'lot') s.qty = 0; s.listing = null; }
    audit(T(ago, 10, 50), s.owner, animalId, 'animal.slaughtered', { qty: n });
  };

  /** Propriété qui change de mains (vente à un inscrit ou don) : historique et santé suivent l'animal, les accès vétérinaires sont retirés. */
  const transfer = async (animalId: Id, to: Id, ago: number) => {
    const s = st(animalId);
    const from = s.owner;
    await q.query('INSERT INTO transfers (animal_id, from_user, to_user, occurred_on, created_at) VALUES ($1,$2,$3,$4,$5)', [animalId, from, to, D(ago), T(ago, 11, 5)]);
    await q.query('UPDATE access_grants SET revoked_on = $2 WHERE animal_id = $1 AND revoked_on IS NULL', [animalId, D(ago)]);
    s.owner = to; s.listing = null;
    const toZone = (await q.query('SELECT zone_id FROM users WHERE id = $1', [to]))[0]?.zone_id;
    if (toZone) s.zone = toZone;
    audit(T(ago, 11, 5), from, animalId, 'animal.transferred', { from, to });
    touch(s, T(ago, 11, 5));
  };

  // -------------------------------------------------------------------------------------------------------------------
  // 2. Les animaux et leur histoire (du plus ancien au plus récent pour chacun)
  // -------------------------------------------------------------------------------------------------------------------

  // --- Kouadio (Seydou, Ferkessédougou) : suivi vétérinaire, pesées, suspicion de fièvre aphteuse écartée.
  const K = ANIMAL.kouadio;
  await flow(K, 'identification', 128, { note: 'Boucle 0A1B2C3D4E5F', by: U.seydou, hour: 8 });
  audit(T(128, 8, 5), U.seydou, K, 'animal.created', { code: 'CI-BOV-00431', kind: 'individual', species: 'bovin' });
  for (const [ago, kg] of [[100, 285], [70, 312], [40, 340], [10, 365]] as const) await flow(K, 'pesee', ago, { weight: kg, by: U.seydou, note: `Pesée au pont-bascule` });
  // Le vaccin « charbon » du seed minimal a été inséré sans journal : on lui ajoute sa ligne d'audit.
  const baseEv = (await q.query('SELECT created_at FROM health_events WHERE id = $1', ['00000000-0000-4000-8000-0000000002a1']))[0];
  if (baseEv) audit(new Date(baseEv.created_at), U.yao, K, 'health.recorded', { eventId: '00000000-0000-4000-8000-0000000002a1', type: 'vaccin' });
  // L'accès du seed minimal (scan, 30 jours) est daté de manière cohérente avec l'histoire.
  await q.query("UPDATE access_grants SET granted_on = $2, expires_on = $3 WHERE animal_id = $1 AND vet_id = $4 AND revoked_on IS NULL", [K, D(5), D(-25), U.yao]);
  audit(T(5, 9, 30), U.yao, K, 'access.granted', { source: 'scan' });
  audit(T(2, 8, 45), U.yao, K, 'access.renewed', { source: 'scan' }); // nouveau scan : l'accès est prolongé
  await grant(K, U.sylla, 'invitation', 80, { by: U.seydou }); // invitation de Seydou, expirée sans être retirée
  const kFmd = await kase(K, { diseases: ['fièvre aphteuse'], n: 1, sev: 'moyenne', symptoms: ['fièvre', 'salivation', 'boiterie'], note: 'Suspicion écartée : prélèvement négatif au laboratoire.', status: 'suivi', ago: 45, by: U.yao });
  await alert({ kind: 'sanitaire', severity: 'haute', zone: Z.ferke, animal: K, title: 'Maladie à déclaration obligatoire : fièvre aphteuse', why: '1 animal(aux) touché(s) dans la zone Ferkessédougou.', ago: 45, handledBy: U.bamba, handledAgo: 44 });
  await caseUpdate(kFmd, K, 'clos', 38, U.yao);
  await health(K, { type: 'vaccin', label: 'Fièvre aphteuse', ago: 36, next: 144, vet: U.yao, note: 'Vaccination de précaution après la suspicion.' });
  await health(K, { type: 'soin', label: 'Vermifuge', ago: 20, next: 70, by: U.seydou });

  // --- Tacheté (Awa, Korhogo) : vache suivie, vaccin corrigé, gestation, mammite avec délai d'attente écoulé, rappels.
  const TA = ANIMAL.tachete;
  audit(T(125, 8, 5), U.awa, TA, 'animal.created', { code: 'CI-BOV-00432', kind: 'individual', species: 'bovin' });
  for (const [ago, kg] of [[110, 410], [75, 425], [40, 440]] as const) await flow(TA, 'pesee', ago, { weight: kg, by: U.awa, note: 'Pesée au ruban' });
  await q.query('UPDATE animals SET avg_weight_kg = 440 WHERE id = $1', [TA]); st(TA).avgWeight = 440;
  audit(T(40, 15, 0), U.awa, TA, 'animal.updated', { fields: ['avgWeightKg'] });
  await photo(TA, 100, 1);
  await health(TA, { type: 'vaccin', label: 'Fièvre aphteuse', ago: 185, next: -5 + 0, by: U.awa, note: 'Rappel en retard : à refaire.' }); // échéance dépassée de 5 jours (rappel « en retard »)
  const wrong = await health(TA, { type: 'vaccin', label: 'Charbon symptomatique', ago: 88, next: 92, by: U.awa, note: 'Date saisie par erreur.' });
  await grant(TA, U.yao, 'invitation', 52, { by: U.awa });
  await health(TA, { type: 'vaccin', label: 'Charbon symptomatique', ago: 58, next: 122, vet: U.yao, corrects: wrong, note: 'Correction : la vaccination date du 58e jour avant aujourd\'hui, pas du 88e.' });
  await health(TA, { type: 'controle', label: 'Gestation confirmée (4 mois)', ago: 50, vet: U.yao, note: 'Vêlage attendu dans 5 mois.' });
  const mam = await kase(TA, { diseases: ['mammite'], n: 1, sev: 'legere', symptoms: ['lait grumeleux', 'pis chaud'], status: 'suivi', ago: 35, by: U.awa });
  await health(TA, { type: 'soin', label: 'Antibiotique (mammite)', ago: 35, wd: 7, vet: U.yao, note: 'Ne pas vendre le lait avant la fin du délai d\'attente.' });
  await caseUpdate(mam, TA, 'gueri', 28, U.awa);
  await health(TA, { type: 'soin', label: 'Vermifuge', ago: 15, next: 2, by: U.awa }); // à refaire dans 2 jours : rappel « bientôt »

  // --- Bande 1 (Awa, Korhogo) : lot de 200 poulets, mortalité, vente partielle, Newcastle, mise en vente en gros.
  const B1 = ANIMAL.bande1;
  await q.query('UPDATE animals SET qty = 200, qty_initial = 200 WHERE id = $1', [B1]);
  st(B1).qty = 200; st(B1).qtyInitial = 200;
  await flow(B1, 'entree', 112, { qty: 200, counterpart: 'Couvoir de Bouaké', note: 'Création du lot', by: U.awa, hour: 8 });
  audit(T(112, 8, 5), U.awa, B1, 'animal.created', { code: 'CI-VOL-00101', kind: 'lot', species: 'volaille' });
  await health(B1, { type: 'vaccin', label: 'Gumboro', ago: 105, vet: U.yao, note: 'Vaccin de la bande à 14 jours.' });
  await health(B1, { type: 'vaccin', label: 'Newcastle', ago: 100, next: 80, by: U.awa });
  await mortality(B1, 12, 90, 'coup de chaleur'); // 6 % : pas d'alerte
  await sell(B1, 75, { qty: 38, counterpart: 'Boucherie du marché de Korhogo', price: 76000 });
  list(B1, 20, 1500, { qty: 120, bulkMin: 100, bulkPrice: 1200 });
  const b1Case = await kase(B1, { diseases: ['maladie de newcastle'], n: 25, sev: 'grave', symptoms: ['toux', 'diarrhée verte', 'torticolis'], note: 'Isoler la bande, désinfecter le poulailler.', deaths: 6, status: 'suivi', ago: 8, by: U.awa });
  await alert({ kind: 'sanitaire', severity: 'haute', zone: Z.korhogo, animal: B1, title: 'Maladie à déclaration obligatoire : maladie de newcastle', why: '25 animal(aux) touché(s) dans la zone Korhogo.', ago: 8 });
  await caseUpdate(b1Case, B1, 'gueri', 2, U.yao);
  // (la mortalité de 6 liée au cas est incluse plus bas dans la vente partielle à Resto : voir « Marché »)

  // --- Noiraud (Awa) : jeune taureau en vente, négociation avec trois acheteurs.
  const NO = ANIMAL.noiraud;
  await animal({ id: NO, code: 'CI-BOV-00500', kind: 'individual', species: 'bovin', breed: "N'Dama", name: 'Noiraud', sex: 'M', bornOn: '2024-03-01', owner: U.awa, zone: Z.korhogo, rfid: 'AA11BB22CC33', ago: 90 });
  await grant(NO, U.yao, 'enregistrement', 90);
  await flow(NO, 'pesee', 60, { weight: 280, by: U.awa });
  await flow(NO, 'pesee', 30, { weight: 310, by: U.awa });
  await health(NO, { type: 'vaccin', label: 'Charbon symptomatique', ago: 45, next: 135, vet: U.yao });
  await photo(NO, 40, 2);
  list(NO, 18, 250000);

  // --- Zébu de Gaoua (Awa → Seydou) : vendu à un éleveur inscrit, la fiche change de compte.
  const ZE = ANIMAL.zebu;
  await animal({ id: ZE, code: 'CI-BOV-00501', kind: 'individual', species: 'bovin', breed: 'Zébu', name: 'Zébu de Gaoua', sex: 'M', bornOn: '2023-01-10', owner: U.awa, zone: Z.korhogo, ago: 140 });
  await grant(ZE, U.yao, 'enregistrement', 139);
  await health(ZE, { type: 'vaccin', label: 'Charbon symptomatique', ago: 120, next: 60, vet: U.yao });
  await health(ZE, { type: 'vaccin', label: 'Charbon symptomatique', ago: 62, next: 118, vet: U.yao });
  list(ZE, 60, 300000);

  // --- Taurillon (Awa → Moussa) : don à un voisin, transfert sans vente.
  const TO = ANIMAL.taurillon;
  await animal({ id: TO, code: 'CI-BOV-00502', kind: 'individual', species: 'bovin', breed: 'Baoulé', name: 'Taurillon', sex: 'M', bornOn: '2024-06-12', owner: U.awa, zone: Z.korhogo, ago: 150 });
  await health(TO, { type: 'vaccin', label: 'Charbon symptomatique', ago: 100, next: 80, by: U.awa });
  list(TO, 100, 180000);
  unlist(TO, 95); // finalement pas à vendre : retiré du marché
  await transfer(TO, U.moussa, 70);
  await flow(TO, 'identification', 70, { note: 'Transfert : don à un voisin pour la saison des cultures', by: U.awa });
  await health(TO, { type: 'vaccin', label: 'Charbon symptomatique', ago: 40, next: 140, by: U.moussa });

  // --- Blanchette (Moussa) : dépistage brucellose, boiterie soignée, vente bloquée par un délai d'attente EN COURS.
  const BL = ANIMAL.blanchette;
  await animal({ id: BL, code: 'CI-BOV-00503', kind: 'individual', species: 'bovin', breed: 'Baoulé', name: 'Blanchette', sex: 'F', bornOn: '2021-05-20', owner: U.moussa, zone: Z.korhogo, ago: 118 });
  await grant(BL, U.yao, 'soin', 80);
  await health(BL, { type: 'controle', label: 'Dépistage brucellose', ago: 80, vet: U.yao, note: 'Résultat négatif.' });
  await flow(BL, 'pesee', 20, { weight: 395, by: U.moussa });
  const boit = await kase(BL, { diseases: ['boiterie'], n: 1, sev: 'legere', symptoms: ['boite de la patte arrière'], status: 'ouvert', ago: 3, by: U.moussa });
  void boit;
  await health(BL, { type: 'soin', label: 'Antibiotique (boiterie)', ago: 3, wd: 10, by: U.moussa, note: 'Délai d\'attente de 10 jours : vente impossible pendant ce temps.' });

  // --- Chèvres de Moussa : achat, PPR (maladie à déclaration obligatoire), forte mortalité, campagne de rappel.
  const CH = ANIMAL.chevres;
  await animal({ id: CH, code: 'CI-CAP-00504', kind: 'lot', species: 'caprin', breed: 'Chèvre naine', name: 'Troupeau de chèvres', owner: U.moussa, zone: Z.korhogo, qty: 40, ago: 100 });
  await flow(CH, 'entree', 100, { qty: 0, counterpart: 'Marché de Korhogo', note: 'Achat des 40 têtes', by: U.moussa, skipState: true });
  await health(CH, { type: 'vaccin', label: 'Peste des petits ruminants', ago: 95, next: -20, by: U.moussa, note: 'Le rappel n\'a pas été fait à temps.' });
  const ppr = await kase(CH, { diseases: ['peste des petits ruminants'], n: 18, sev: 'grave', symptoms: ['fièvre', 'diarrhée', 'toux', 'écoulement nasal'], note: 'Isolement des malades, prévenir la zone.', deaths: 10, status: 'ouvert', ago: 9, by: U.moussa });
  await alert({ kind: 'sanitaire', severity: 'haute', zone: Z.korhogo, animal: CH, title: 'Maladie à déclaration obligatoire : peste des petits ruminants', why: '18 animal(aux) touché(s) dans la zone Korhogo.', ago: 9, handledBy: U.autorite, handledAgo: 8 });
  await mortality(CH, 10, 8, 'PPR suspectée'); // 25 % du lot : alerte de forte mortalité
  await caseUpdate(ppr, CH, 'suivi', 7, U.yao);
  await health(CH, { type: 'vaccin', label: 'Vaccination PPR (campagne)', ago: 6, next: 174, vet: U.yao, note: 'Campagne dans le village après le foyer.' });
  await mortality(CH, 3, 4, 'PPR');

  // --- Poules pondeuses de Moussa, et Pintades d'Awa : deux autres élevages touchés par Newcastle -> foyer suspect.
  const PP = ANIMAL.poulesPonte;
  await animal({ id: PP, code: 'CI-VOL-00505', kind: 'lot', species: 'volaille', breed: 'Pondeuse', name: 'Poules pondeuses', owner: U.moussa, zone: Z.korhogo, qty: 120, ago: 85 });
  await health(PP, { type: 'vaccin', label: 'Newcastle', ago: 80, next: -10, by: U.moussa, note: 'Rappel manqué : à refaire.' });
  await kase(PP, { diseases: ['maladie de newcastle'], n: 15, sev: 'moyenne', symptoms: ['toux', 'ponte en baisse'], deaths: 7, status: 'suivi', ago: 12, by: U.moussa });
  await alert({ kind: 'sanitaire', severity: 'haute', zone: Z.korhogo, animal: PP, title: 'Maladie à déclaration obligatoire : maladie de newcastle', why: '15 animal(aux) touché(s) dans la zone Korhogo.', ago: 12 });
  await mortality(PP, 7, 11, 'Newcastle');

  const PI = ANIMAL.pintades;
  await animal({ id: PI, code: 'CI-VOL-00506', kind: 'lot', species: 'volaille', breed: 'Pintade locale', name: 'Pintades', owner: U.awa, zone: Z.korhogo, qty: 30, ago: 70 });
  await health(PI, { type: 'vaccin', label: 'Newcastle', ago: 65, next: 115, by: U.awa });
  const piCase = await kase(PI, { diseases: ['maladie de newcastle'], n: 5, sev: 'moyenne', symptoms: ['toux'], status: 'suivi', ago: 10, by: U.awa });
  await alert({ kind: 'sanitaire', severity: 'haute', zone: Z.korhogo, animal: PI, title: 'Maladie à déclaration obligatoire : maladie de newcastle', why: '5 animal(aux) touché(s) dans la zone Korhogo.', ago: 10 });
  await caseUpdate(piCase, PI, 'gueri', 4, U.awa);
  // Troisième élevage touché en 14 jours (Bande 1, il y a 8 jours) : foyer suspect, pris en charge par l'agent de la zone.
  await alert({ kind: 'sanitaire', severity: 'moyenne', zone: Z.korhogo, title: 'Foyer suspect : maladie de newcastle', why: '3 élevages de Korhogo touchés en 14 jours.', ago: 8, handledBy: U.soro, handledAgo: 6 });
  list(PI, 12, 4000);

  // --- Porcs de Fatou (Bouaké) : contrôle de biosécurité, pesées, abattages partiel puis total.
  const PO = ANIMAL.porcs;
  await animal({ id: PO, code: 'CI-POR-00507', kind: 'lot', species: 'porcin', breed: 'Large White', name: "Porcs d'engraissement", owner: U.fatou, zone: Z.bouake, qty: 25, ago: 95 });
  await health(PO, { type: 'controle', label: 'Inspection de biosécurité', ago: 90, vet: U.sylla, note: 'Clôture et pédiluve conformes ; peste porcine africaine : aucun signe.' });
  await grant(PO, U.sylla, 'soin', 90);
  await flow(PO, 'pesee', 60, { weight: 45, by: U.fatou, note: 'Poids moyen par tête' });
  await health(PO, { type: 'soin', label: 'Vermifuge', ago: 50, wd: 3, by: U.fatou });
  await flow(PO, 'pesee', 30, { weight: 78, by: U.fatou, note: 'Poids moyen par tête' });
  await slaughter(PO, 12, "Abattoir de Bouaké", 10);
  await slaughter(PO, 2, "Abattoir de Bouaké (solde du lot)");

  // --- Lapins de Kouamé (Daloa) : achat, naissances, mortalité, diarrhée (maladie non notifiable), traitement.
  const LA = ANIMAL.lapins;
  await animal({ id: LA, code: 'CI-LAP-00508', kind: 'lot', species: 'lapin', breed: 'Néo-zélandais', name: 'Lapins de Daloa', owner: U.kouame, zone: Z.daloa, qty: 60, ago: 80 });
  await flow(LA, 'entree', 40, { qty: 12, note: 'Naissances de la portée', by: U.kouame }); st(LA).qty = st(LA).qty! + 12;
  await mortality(LA, 4, 30, 'diarrhée');
  const diar = await kase(LA, { diseases: ['diarrhée'], n: 9, sev: 'moyenne', symptoms: ['selles liquides', 'perte d\'appétit'], status: 'ouvert', ago: 29, by: U.kouame });
  await health(LA, { type: 'soin', label: 'Traitement anticoccidien', ago: 28, wd: 5, by: U.kouame });
  await caseUpdate(diar, LA, 'suivi', 25, U.sylla);
  await health(LA, { type: 'controle', label: 'Visite de suivi', ago: 25, vet: U.sylla, note: 'Amélioration nette, continuer le traitement.' });

  // --- Tilapias de Kouamé : lot de 800, mortalité forte, maladie des branchies.
  const TI = ANIMAL.tilapia;
  await animal({ id: TI, code: 'CI-POI-00509', kind: 'lot', species: 'poisson', breed: 'Tilapia du Nil', name: 'Bassin de tilapias', owner: U.kouame, zone: Z.daloa, qty: 800, ago: 70 });
  await flow(TI, 'pesee', 50, { weight: 0.15, by: U.kouame, note: 'Poids moyen par poisson (kg)' });
  await flow(TI, 'pesee', 20, { weight: 0.38, by: U.kouame, note: 'Poids moyen par poisson (kg)' });
  await mortality(TI, 200, 15, "manque d'oxygène dans le bassin");
  await kase(TI, { diseases: ['maladie des branchies'], n: 150, sev: 'moyenne', symptoms: ['respiration en surface', 'branchies pâles'], status: 'suivi', ago: 14, by: U.kouame });

  // --- Mouton de la Tabaski (Seydou) : vol non résolu. Chèvre Fatim (Moussa) : volée puis retrouvée. Bélier Sahel : vendu.
  const TB = ANIMAL.tabaski;
  await animal({ id: TB, code: 'CI-OVI-00510', kind: 'individual', species: 'ovin', breed: 'Djallonké', name: 'Mouton de la Tabaski', sex: 'M', bornOn: '2024-04-02', owner: U.seydou, zone: Z.ferke, ago: 60 });
  await health(TB, { type: 'vaccin', label: 'Peste des petits ruminants', ago: 55, next: 125, by: U.seydou });
  await q.query("UPDATE animals SET status = 'vole', listed_at = NULL WHERE id = $1", [TB]); st(TB).status = 'vole';
  await flow(TB, 'vol', 9, { note: 'Disparu du pâturage pendant la nuit', by: U.seydou });
  const theft = await alert({ kind: 'vol', severity: 'haute', zone: Z.ferke, animal: TB, title: 'Vol déclaré : CI-OVI-00510', why: 'ovin (animal seul) déclaré volé dans la zone Ferkessédougou.', ago: 9 });
  audit(T(9, 10, 5), U.seydou, TB, 'animal.theft_declared', { alertId: theft });

  const FA = ANIMAL.fatim;
  await animal({ id: FA, code: 'CI-CAP-00511', kind: 'individual', species: 'caprin', breed: 'Chèvre du Sahel', name: 'Chèvre Fatim', sex: 'F', bornOn: '2023-09-15', owner: U.moussa, zone: Z.korhogo, ago: 110 });
  st(FA).status = 'vole';
  await flow(FA, 'vol', 26, { note: 'Disparue au retour du pâturage', by: U.moussa });
  const theft2 = await alert({ kind: 'vol', severity: 'haute', zone: Z.korhogo, animal: FA, title: 'Vol déclaré : CI-CAP-00511', why: 'caprin (animal seul) déclaré volé dans la zone Korhogo.', ago: 26, handledBy: U.moussa, handledAgo: 22 });
  audit(T(26, 18, 0), U.moussa, FA, 'animal.theft_declared', { alertId: theft2 });
  st(FA).status = 'actif';
  await flow(FA, 'entree', 22, { note: 'Retrouvé : retrouvée chez un voisin après un appel de l\'agent', by: U.moussa });
  audit(T(22, 14, 30), U.moussa, FA, 'animal.recovered');

  const BE = ANIMAL.belier;
  await animal({ id: BE, code: 'CI-OVI-00512', kind: 'individual', species: 'ovin', breed: 'Djallonké', name: 'Bélier Sahel', sex: 'M', bornOn: '2023-02-11', owner: U.seydou, zone: Z.ferke, ago: 100 });
  await grant(BE, U.yao, 'invitation', 90, { by: U.seydou, revokedAgo: 85 }); // accès donné puis retiré par le propriétaire
  await health(BE, { type: 'vaccin', label: 'Peste des petits ruminants', ago: 95, next: 85, by: U.seydou });
  list(BE, 40, 85000);
  await sell(BE, 33, { counterpart: 'Marché de bétail de Ferkessédougou', price: 85000 });

  // --- Veau Bleuet (Awa) : mortalité d'un animal seul.
  const BLE = ANIMAL.bleuet;
  await animal({ id: BLE, code: 'CI-BOV-00513', kind: 'individual', species: 'bovin', breed: 'Zébu', name: 'Veau Bleuet', sex: 'M', bornOn: D(80), owner: U.awa, zone: Z.korhogo, ago: 75 });
  await mortality(BLE, 1, 14, 'diarrhée néonatale');

  // -------------------------------------------------------------------------------------------------------------------
  // 3. Marché : annonces, demandes, discussion, accords, ventes (voir le README pour le détail)
  // -------------------------------------------------------------------------------------------------------------------
  let reqSeq = 0;
  type Prop = { qty: number; unit: number } | null;
  interface Req {
    animal: Id; buyer: Id; seller: Id; ago: number; qty: number; offered?: number; message?: string; status: 'en_attente' | 'acceptee' | 'refusee' | 'annulee' | 'conclue';
    b?: Prop; s?: Prop; agreed?: { qty: number; unit: number }; decidedAgo?: number; completedAgo?: number; sellerNote?: string;
  }
  const request = async (r: Req): Promise<Id> => {
    const id = uid('05', ++reqSeq);
    const unit0 = r.b?.unit ?? r.offered ?? 0;
    await q.query(
      `INSERT INTO purchase_requests (id, animal_id, buyer_id, seller_id, message, offered_price, agreed_price, status, seller_note, created_at, decided_at, completed_at,
                                      qty, agreed_qty, buyer_qty, buyer_unit_price, seller_qty, seller_unit_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, r.animal, r.buyer, r.seller, r.message ?? null, r.offered ?? null, r.agreed?.unit ?? null, r.status, r.sellerNote ?? null, T(r.ago, 9, 0),
       r.decidedAgo === undefined ? null : T(r.decidedAgo, 16, 0), r.completedAgo === undefined ? null : T(r.completedAgo, 11, 0),
       r.agreed?.qty ?? r.qty, r.agreed?.qty ?? null, (r.b ?? { qty: r.qty, unit: unit0 }).qty, (r.b ?? { qty: r.qty, unit: unit0 }).unit, r.s?.qty ?? null, r.s?.unit ?? null],
    );
    const species = st(r.animal).species;
    const n = names.get(r.animal)!;
    audit(T(r.ago, 9, 0), r.buyer, r.animal, 'market.request_sent', { requestId: id, qty: r.qty, offeredPrice: r.offered ?? null });
    await notify(r.seller, 'purchase_request', `Demande d'achat : ${n}`, `${names.get(r.buyer)} souhaite acheter ${unitsLabel(species, r.qty)} à ${fcfa(unit0)} l'unité (${fcfa(unit0 * r.qty)}).`, `/demandes?ouvrir=${id}`, T(r.ago, 9, 0), r.ago > 5);
    if (r.message) await say(id, T(r.ago, 9, 0), r.buyer, 'text', r.message);
    await say(id, T(r.ago, 9, 1), r.buyer, 'proposal', `Je propose : ${unitsLabel(species, r.qty)} à ${fcfa(unit0)} l'unité, soit ${fcfa(unit0 * r.qty)}.`, { qty: r.qty, unit: unit0 });
    return id;
  };
  const say = async (reqId: Id, at: Date, sender: Id | null, kind: 'text' | 'proposal' | 'recap' | 'system', body: string, p?: { qty: number; unit: number }) => {
    await q.query('INSERT INTO purchase_messages (request_id, sender_id, kind, body, qty, unit_price, total, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [reqId, sender, kind, body, p?.qty ?? null, p?.unit ?? null, p ? p.qty * p.unit : null, at]);
  };
  const notify = async (user: Id, kind: string, title: string, body: string, link: string, at: Date, read: boolean) => {
    await q.query('INSERT INTO notifications (user_id, kind, title, body, link, read_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [user, kind, title, body, link, read ? new Date(at.getTime() + 2 * HOUR) : null, at]);
    counts.notifications++;
  };
  const proposal = async (reqId: Id, ago: number, hour: number, who: Id, role: 'acheteur' | 'vendeur', species: string, p: { qty: number; unit: number }) => {
    await say(reqId, T(ago, hour, 0), who, 'proposal', `Proposition (${role}) : ${unitsLabel(species, p.qty)} à ${fcfa(p.unit)} l'unité, soit ${fcfa(p.qty * p.unit)}.`, p);
  };
  /** Accord conclu : récapitulatif dans la conversation, notifications aux deux parties, quantité réservée. */
  const agreement = async (reqId: Id, animalId: Id, buyer: Id, seller: Id, ago: number, p: { qty: number; unit: number }, tierNote = '') => {
    const s = st(animalId);
    const n = names.get(animalId)!;
    const code = (await q.query('SELECT public_code FROM animals WHERE id = $1', [animalId]))[0]!.public_code;
    await say(reqId, T(ago, 10, 0), null, 'recap',
      `Accord conclu\nAnimal : ${n} (${code})\nQuantité : ${unitsLabel(s.species, p.qty)}\nPrix à l'unité : ${fcfa(p.unit)}${tierNote}\nTotal : ${fcfa(p.qty * p.unit)}\nVous pouvez maintenant vous contacter pour convenir de la remise.`, p);
    for (const [uid2, other] of [[buyer, seller], [seller, buyer]] as const) {
      await notify(uid2, 'purchase_accepted', `Accord conclu : ${n}`, `${unitsLabel(s.species, p.qty)} × ${fcfa(p.unit)} = ${fcfa(p.qty * p.unit)} avec ${names.get(other)}.`, `/demandes?ouvrir=${reqId}`, T(ago, 10, 0), ago > 3);
    }
    audit(T(ago, 10, 0), buyer, animalId, 'market.agreement', { requestId: reqId, qty: p.qty, unitPrice: p.unit, total: p.qty * p.unit });
  };
  const finish = async (reqId: Id, animalId: Id, buyer: Id, seller: Id, ago: number, p: { qty: number; unit: number }, newAnimalId?: Id) => {
    const s = st(animalId);
    await say(reqId, T(ago, 11, 0), null, 'system', `Vente enregistrée : ${unitsLabel(s.species, p.qty)} pour ${fcfa(p.qty * p.unit)}.`, { qty: p.qty, unit: p.unit });
    await notify(buyer, 'purchase_done', `Achat finalisé : ${names.get(animalId)}`, newAnimalId ? `Un lot de ${unitsLabel(s.species, p.qty)} avec son carnet de santé est maintenant sur votre compte.` : 'La fiche et son carnet de santé sont maintenant sur votre compte.', `/animaux/${newAnimalId ?? animalId}`, T(ago, 11, 0), true);
    audit(T(ago, 11, 0), seller, animalId, 'market.sold_to_buyer', { requestId: reqId, qty: p.qty, unitPrice: p.unit, price: p.qty * p.unit });
  };

  // (a) Noiraud : trois acheteurs. Sahel refusé, Resto annule, Koffi tombe d'accord (accord en attente de conclusion).
  const rSahel = await request({ animal: NO, buyer: U.sahel, seller: U.awa, ago: 17, qty: 1, offered: 180000, message: 'Bonjour, je prends pour ma boucherie, 180 000 FCFA ?', status: 'refusee', decidedAgo: 16, sellerNote: 'Trop bas, il vaut mieux que cela.' });
  await say(rSahel, T(16, 16, 5), U.awa, 'text', 'Trop bas, il vaut mieux que cela.');
  await say(rSahel, T(16, 16, 6), null, 'system', 'Awa Koné a refusé la demande.');
  await notify(U.sahel, 'purchase_refused', 'Demande refusée : Noiraud', 'Trop bas, il vaut mieux que cela.', `/demandes?ouvrir=${rSahel}`, T(16, 16, 6), true);
  audit(T(16, 16, 6), U.awa, NO, 'market.request_refused', { requestId: rSahel });

  const rResto = await request({ animal: NO, buyer: U.resto, seller: U.awa, ago: 14, qty: 1, offered: 240000, message: 'Livraison possible à Abidjan ?', status: 'annulee', decidedAgo: 13 });
  await say(rResto, T(14, 12, 0), U.awa, 'text', "Non, l'animal se retire sur place à Korhogo.");
  await say(rResto, T(13, 8, 30), null, 'system', 'Restaurant Le Baobab a retiré sa demande.');
  await notify(U.awa, 'purchase_cancelled', 'Demande annulée : Noiraud', 'Restaurant Le Baobab a retiré sa demande.', `/demandes?ouvrir=${rResto}`, T(13, 8, 30), true);
  audit(T(13, 8, 30), U.resto, NO, 'market.request_cancelled', { requestId: rResto });

  const rKoffi = await request({ animal: NO, buyer: U.koffi, seller: U.awa, ago: 10, qty: 1, offered: 230000, message: 'Intéressé, je peux passer samedi ?', status: 'acceptee', agreed: { qty: 1, unit: 235000 }, b: { qty: 1, unit: 235000 }, s: { qty: 1, unit: 235000 }, decidedAgo: 6 });
  await say(rKoffi, T(10, 10, 0), U.awa, 'text', 'Oui samedi. Mon prix est de 240 000 FCFA.');
  await proposal(rKoffi, 10, 10, U.awa, 'vendeur', 'bovin', { qty: 1, unit: 240000 });
  await proposal(rKoffi, 9, 17, U.koffi, 'acheteur', 'bovin', { qty: 1, unit: 235000 });
  await proposal(rKoffi, 6, 9, U.awa, 'vendeur', 'bovin', { qty: 1, unit: 235000 });
  await agreement(rKoffi, NO, U.koffi, U.awa, 6, { qty: 1, unit: 235000 });
  await say(rKoffi, T(5, 8, 0), U.koffi, 'text', 'Parfait, je passe samedi matin avec le paiement.');
  audit(T(6, 9, 0), U.awa, NO, 'market.request_accepted', { requestId: rKoffi });

  // (b) Zébu de Gaoua : vendu à Seydou, éleveur inscrit (transfert de la fiche).
  const rZeb = await request({ animal: ZE, buyer: U.seydou, seller: U.awa, ago: 58, qty: 1, offered: 280000, message: 'Je cherche un taureau de reproduction.', status: 'conclue', agreed: { qty: 1, unit: 285000 }, b: { qty: 1, unit: 285000 }, s: { qty: 1, unit: 285000 }, decidedAgo: 56, completedAgo: 55 });
  await proposal(rZeb, 57, 10, U.awa, 'vendeur', 'bovin', { qty: 1, unit: 285000 });
  await proposal(rZeb, 56, 9, U.seydou, 'acheteur', 'bovin', { qty: 1, unit: 285000 });
  await agreement(rZeb, ZE, U.seydou, U.awa, 56, { qty: 1, unit: 285000 });
  await sellToRegistered(ZE, U.seydou, 55, 285000);
  await finish(rZeb, ZE, U.seydou, U.awa, 55, { qty: 1, unit: 285000 });
  await health(ZE, { type: 'vaccin', label: 'Charbon symptomatique', ago: 30, next: 150, by: U.seydou, note: 'Premier vaccin chez son nouveau propriétaire.' });

  // (c) Pintades : lot entier vendu à un particulier (Koffi), qui devient propriétaire d'un lot.
  const rPin = await request({ animal: PI, buyer: U.koffi, seller: U.awa, ago: 9, qty: 30, offered: 3500, message: 'Je prends tout le lot.', status: 'conclue', agreed: { qty: 30, unit: 3500 }, b: { qty: 30, unit: 3500 }, s: { qty: 30, unit: 3500 }, decidedAgo: 7, completedAgo: 3 });
  await proposal(rPin, 8, 10, U.awa, 'vendeur', 'volaille', { qty: 30, unit: 3800 });
  await proposal(rPin, 8, 15, U.koffi, 'acheteur', 'volaille', { qty: 30, unit: 3500 });
  await proposal(rPin, 7, 9, U.awa, 'vendeur', 'volaille', { qty: 30, unit: 3500 });
  await agreement(rPin, PI, U.koffi, U.awa, 7, { qty: 30, unit: 3500 });
  await sellToRegistered(PI, U.koffi, 3, 105000);
  await finish(rPin, PI, U.koffi, U.awa, 3, { qty: 30, unit: 3500 });

  // (d) Bande 1 : 120 poulets en vente, prix dégressif (1 500 FCFA, 1 200 dès 100). Resto en prend 100 (lot scindé).
  const rBand = await request({ animal: B1, buyer: U.resto, seller: U.awa, ago: 9, qty: 100, message: 'Pour le restaurant, livraison samedi.', status: 'conclue', agreed: { qty: 100, unit: 1250 }, b: { qty: 100, unit: 1250 }, s: { qty: 100, unit: 1250 }, decidedAgo: 7, completedAgo: 4 });
  await say(rBand, T(9, 14, 0), U.awa, 'text', 'Je peux faire mieux ?');
  await proposal(rBand, 8, 9, U.awa, 'vendeur', 'volaille', { qty: 100, unit: 1300 });
  await proposal(rBand, 8, 12, U.resto, 'acheteur', 'volaille', { qty: 100, unit: 1250 });
  await proposal(rBand, 7, 9, U.awa, 'vendeur', 'volaille', { qty: 100, unit: 1250 });
  await agreement(rBand, B1, U.resto, U.awa, 7, { qty: 100, unit: 1250 });
  // Vente partielle à un inscrit : 100 poulets quittent la bande d'Awa et deviennent un nouveau lot chez Resto, avec les vaccins.
  {
    const s = st(B1);
    const when = 4;
    await flow(B1, 'vente', when, { qty: 100, counterpart: names.get(U.resto), note: 'Prix : 125000 FCFA', by: U.awa });
    s.qty = s.qty! - 100;
    s.listing = { ...s.listing!, qty: Math.max(0, s.listing!.qty - 100) };
    if (s.listing.qty === 0) s.listing = null;
    await animal({ id: ANIMAL.lotResto, code: 'CI-VOL-00514', kind: 'lot', species: 'volaille', name: 'Poulets de chair — bande 1', owner: U.resto, zone: Z.abidjan, qty: 100, ago: when });
    await q.query('UPDATE animals SET split_from = $2 WHERE id = $1', [ANIMAL.lotResto, B1]);
    // animal() a écrit « Création du lot » : pour un lot acheté, l'entrée mentionne le vendeur.
    await q.query("UPDATE audit_log SET action = action WHERE false"); // (le journal est en ajout seul : rien à corriger ici)
    await q.query(
      `INSERT INTO health_events (animal_id, type, label, done_on, next_due_on, withdrawal_days, vet_id, recorded_by, note, created_at)
       SELECT $1, e.type, e.label, e.done_on, e.next_due_on, e.withdrawal_days, e.vet_id, e.recorded_by,
              CASE WHEN e.note IS NULL THEN 'Hérité du lot CI-VOL-00101' ELSE e.note || ' · hérité du lot CI-VOL-00101' END, $3
       FROM health_events e WHERE e.animal_id = $2 AND NOT EXISTS (SELECT 1 FROM health_events c WHERE c.corrects_event_id = e.id)
       ORDER BY e.done_on, e.created_at`,
      [ANIMAL.lotResto, B1, T(when, 11, 0)],
    );
    audit(T(when, 11, 0), U.awa, B1, 'animal.sold', { qty: 100, buyerId: U.resto, price: 125000, splitTo: ANIMAL.lotResto });
    audit(T(when, 11, 0), U.awa, ANIMAL.lotResto, 'animal.split_received', { qty: 100, from: B1, price: 125000 });
    await finish(rBand, B1, U.resto, U.awa, when, { qty: 100, unit: 1250 }, ANIMAL.lotResto);
  }
  // Il reste 20 poulets en vente : Seydou en demande 20 (demande en attente, prix normal sous le seuil de 100).
  await request({ animal: B1, buyer: U.seydou, seller: U.awa, ago: 2, qty: 20, offered: 1500, message: 'Je prends les 20 derniers pour mon élevage.', status: 'en_attente' });

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Photos, appels hors ligne, enregistrement de l'état final des animaux
  // -------------------------------------------------------------------------------------------------------------------
  await photo(K, 120, 3);
  await photo(K, 118, 4, { removed: true }); // une photo ajoutée par erreur, puis retirée
  await q.query(
    `INSERT INTO client_ops (client_id, user_id, type, status, result, created_at) VALUES ($1,$2,'health.create','ok',$3,$4)`,
    [uid('08', 1), U.awa, JSON.stringify({ id: uid('03', 999) }), T(15, 6, 40)],
  );
  await q.query(
    `INSERT INTO client_ops (client_id, user_id, type, status, result, created_at) VALUES ($1,$2,'sale','error',$3,$4)`,
    [uid('08', 2), U.seydou, JSON.stringify({ status: 409, code: 'withdrawal_active', message: "Délai d'attente avant vente en cours." }), T(11, 7, 5)],
  );

  for (const s of states.values()) {
    await q.query(
      `UPDATE animals SET owner_id = $2, zone_id = $3, status = $4, qty = $5, qty_initial = COALESCE($6, qty_initial),
              listed_at = $7, listing_price = $8, listing_qty = $9, bulk_min_qty = $10, bulk_price = $11, updated_at = $12 WHERE id = $1`,
      [s.id, s.owner, s.zone, s.status, s.qty, s.qtyInitial, s.listing?.at ?? null, s.listing?.price ?? null, s.listing?.qty ?? null, s.listing?.bulkMin ?? null, s.listing?.bulkPrice ?? null, s.updated],
    );
  }

  // Le journal est en ajout seul et son numéro suit l'ordre d'insertion : on l'écrit trié par date.
  audits.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const a of audits) {
    await q.query('INSERT INTO audit_log (actor_id, animal_id, action, detail, at) VALUES ($1,$2,$3,$4,$5)', [a.actor, a.animal, a.action, a.detail === null ? null : JSON.stringify(a.detail), a.at]);
  }

  // Rappels : le même travail que la tâche de l'application (vaccins à refaire sous 3 jours ou en retard).
  const reminders = await createReminderNotifications({ query: q.query.bind(q) } as never);
  counts.notifications += reminders;
  // Quelques rappels sont déjà lus, d'autres non : l'écran des notifications montre les deux états.
  await q.query("UPDATE notifications SET read_at = created_at + interval '3 hours' WHERE kind = 'reminder' AND title LIKE 'En retard%' AND user_id = $1", [U.moussa]);

  await verify(q);
  return { skipped: false, counts: await tableCounts(q) };

  // --- vente à un inscrit (compte qui change) : définie ici pour rester près de son usage ---
  async function sellToRegistered(animalId: Id, buyer: Id, ago: number, price: number) {
    const s = st(animalId);
    const qty = s.kind === 'lot' ? s.qty! : 1;
    await flow(animalId, 'vente', ago, { qty: s.kind === 'lot' ? qty : undefined, counterpart: names.get(buyer), note: `Prix : ${price} FCFA`, by: s.owner });
    audit(T(ago, 10, 40), s.owner, animalId, 'animal.sold', { qty, buyerId: buyer, price });
    await transfer(animalId, buyer, ago);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrôles de cohérence : le jeu doit respecter les règles de gestion, sinon on le dit tout de suite.
// ---------------------------------------------------------------------------------------------------------------------
export async function verify(q: Queryable): Promise<void> {
  const bad: string[] = [];
  const check = async (label: string, sql: string) => { const r = await q.query(sql); if (r.length) bad.push(`${label} : ${r.map((x) => x.id ?? x.name ?? JSON.stringify(x)).join(', ')}`); };
  // RG5 : l'effectif d'un lot est la somme de ses entrées moins ses sorties (hors lots volés ou cédés en bloc : le lot suit son nouveau propriétaire).
  await check('effectif de lot incohérent', `
    SELECT a.public_code AS id FROM animals a
    WHERE a.kind = 'lot' AND NOT EXISTS (SELECT 1 FROM flows f WHERE f.animal_id = a.id AND f.type = 'vol')
      AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.animal_id = a.id)
      AND a.qty <> COALESCE((SELECT sum(CASE WHEN f.type = 'entree' THEN f.qty WHEN f.type IN ('mortalite','vente','abattage') THEN -f.qty END) FROM flows f WHERE f.animal_id = a.id), 0)`);
  await check('statut sans événement correspondant', `
    SELECT a.public_code AS id FROM animals a WHERE
      (a.status = 'vendu' AND NOT EXISTS (SELECT 1 FROM flows f WHERE f.animal_id = a.id AND f.type = 'vente'))
   OR (a.status = 'abattu' AND NOT EXISTS (SELECT 1 FROM flows f WHERE f.animal_id = a.id AND f.type = 'abattage'))
   OR (a.status = 'decede' AND NOT EXISTS (SELECT 1 FROM flows f WHERE f.animal_id = a.id AND f.type = 'mortalite'))
   OR (a.status = 'vole' AND NOT EXISTS (SELECT 1 FROM flows f WHERE f.animal_id = a.id AND f.type = 'vol'))`);
  await check('annonce sur un animal non actif', "SELECT public_code AS id FROM animals WHERE listed_at IS NOT NULL AND status <> 'actif'");
  await check('annonce hors du stock', "SELECT public_code AS id FROM animals WHERE listed_at IS NOT NULL AND kind = 'lot' AND listing_qty > qty");
  await check('transfert sans changement de propriétaire', 'SELECT t.animal_id AS id FROM transfers t JOIN animals a ON a.id = t.animal_id WHERE a.owner_id NOT IN (SELECT to_user FROM transfers WHERE animal_id = t.animal_id)');
  await check('accès actif sur un animal qui a changé de main', 'SELECT g.animal_id AS id FROM access_grants g WHERE g.revoked_on IS NULL AND EXISTS (SELECT 1 FROM transfers t WHERE t.animal_id = g.animal_id AND t.occurred_on >= g.granted_on)');
  await check('accord sans quantité', "SELECT id FROM purchase_requests WHERE status IN ('acceptee','conclue') AND (agreed_qty IS NULL OR agreed_price IS NULL)");
  await check('quantités réservées au-delà de la mise en vente', `
    SELECT a.public_code AS id FROM animals a WHERE a.listed_at IS NOT NULL
      AND COALESCE((SELECT sum(agreed_qty) FROM purchase_requests p WHERE p.animal_id = a.id AND p.status = 'acceptee'), 0) > a.listing_qty`);
  await check("action d'audit inconnue de l'application", (
    "SELECT DISTINCT action AS id FROM audit_log WHERE action NOT IN (" + KNOWN_ACTIONS.map((a) => `'${a}'`).join(',') + ')'));
  // Chaque action doit se lire en français dans le journal (aucune ne retombe sur son nom technique).
  const actions = await q.query<{ action: string }>('SELECT DISTINCT action FROM audit_log');
  for (const { action } of actions) if (describeAction(action, {}, { byMe: true }) === action) bad.push(`pas de libellé pour ${action}`);
  if (bad.length) throw new Error(`Jeu de données incohérent :\n- ${bad.join('\n- ')}`);
}

const KNOWN_ACTIONS = [
  'auth.register', 'auth.login', 'auth.locked', 'auth.password_changed', 'auth.password_reset_requested', 'auth.password_reset', 'auth.pin_changed', 'vet.verified',
  'animal.created', 'animal.updated', 'animal.photo_added', 'animal.photo_removed', 'health.recorded', 'health.corrected', 'animal.mortality', 'case.opened', 'case.updated',
  'animal.sold', 'animal.slaughtered', 'animal.transferred', 'animal.theft_declared', 'animal.recovered', 'access.granted', 'access.renewed', 'access.revoked',
  'market.listed', 'market.unlisted', 'market.request_sent', 'market.request_accepted', 'market.request_refused', 'market.request_cancelled', 'market.agreement',
  'animal.split_received', 'market.sold_to_buyer', 'alert.handled',
];

async function tableCounts(q: Queryable): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ['users', 'animals', 'health_events', 'cases', 'flows', 'transfers', 'access_grants', 'alerts', 'purchase_requests', 'purchase_messages', 'notifications', 'animal_photos', 'audit_log']) {
    out[t] = Number((await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`))[0]!.n);
  }
  return out;
}

// Exécution directe : `pnpm seed:complet [--reset --yes]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  const config = loadConfig();
  const db = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
  await migrate(db);
  if (args.has('--reset')) {
    if (process.env.NODE_ENV === 'production') { console.error('Refusé : --reset est interdit en production.'); await db.close(); process.exit(1); }
    if (!args.has('--yes')) { console.error('Cette commande EFFACE toutes les données. Ajoutez --yes pour confirmer.'); await db.close(); process.exit(1); }
    await db.tx((q) => resetAll(q));
    console.log('Toutes les données ont été effacées.');
  }
  const report = await db.tx((q) => seedComplet(q));
  if (report.skipped) console.log('Le jeu complet est déjà chargé. (Pour repartir de zéro : --reset --yes)');
  else {
    console.log('Jeu de données complet chargé :');
    for (const [t, n] of Object.entries(report.counts)) console.log(`  ${t.padEnd(18)} ${n}`);
  }
  console.log(`Mot de passe de tous les comptes : ${DEMO_PASSWORD}`);
  await db.close();
}
