import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let awa: string, seydou: string, vet: string, agent: string, autorite: string, unverified: string;
let vetId: string, unverifiedId: string, awaId: string;
const SEYDOU_COW = '00000000-0000-4000-8000-0000000001a1';

const call = (method: string, url: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { ...bearer(token), ...headers } });

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const newCow = async (name = 'Vache') => (await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name })).json();
const newLot = async (qty: number, name = 'Lot') => (await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name, qty })).json();
const grantTo = (animalId: string, id = vetId) => call('POST', `/animals/${animalId}/access`, awa, { vetId: id });
const vaccin = (extra: Record<string, unknown> = {}) => ({ type: 'vaccin', label: 'Charbon', doneOn: day(0), ...extra });

beforeAll(async () => {
  ctx = await setup();
  awa = (await login(ctx.app, '0712345678')).body.accessToken;
  seydou = (await login(ctx.app, '0723456789')).body.accessToken;
  const v = (await login(ctx.app, '0501020304')).body;
  vet = v.accessToken; vetId = v.user.id;
  agent = (await login(ctx.app, '0102030405')).body.accessToken;
  autorite = (await login(ctx.app, '0505050505')).body.accessToken;
  awaId = (await login(ctx.app, '0712345678')).body.user.id;
  const reg = await ctx.app.inject({ method: 'POST', url: '/auth/register', payload: { role: 'vet', name: 'Dr Nouveau', phone: '0700000077', password: 'motdepasse1', orderNumber: 'ONV-CI-0777' } });
  unverified = reg.json().accessToken; unverifiedId = reg.json().user.id;
});
afterAll(async () => { await ctx.close(); });

describe('accès vétérinaire (RG1)', () => {
  it('un vétérinaire non vérifié ne peut pas scanner', async () => {
    const r = await call('POST', '/access/scan', unverified, { code: 'CI-BOV-00432' });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('vet_not_verified');
  });
  it('seul un vétérinaire scanne', async () => {
    expect((await call('POST', '/access/scan', awa, { code: 'CI-BOV-00432' })).statusCode).toBe(403);
  });
  it('un scan crée un accès de 30 jours, un second scan le prolonge', async () => {
    const a = await call('POST', '/access/scan', vet, { code: 'ci-bov-00432' });
    expect(a.statusCode).toBe(200);
    expect(a.json().created).toBe(true);
    expect(a.json().expiresOn).toBe(day(30));
    await ctx.db.query("UPDATE access_grants SET expires_on = current_date + 3 WHERE source = 'scan' AND animal_id = $1", [a.json().animalId]);
    const b = await call('POST', '/access/scan', vet, { code: 'CI-BOV-00432' });
    expect(b.json().created).toBe(false);
    expect(b.json().expiresOn).toBe(day(30));
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM access_grants WHERE animal_id = $1 AND vet_id = $2', [a.json().animalId, vetId]))[0]!.n).toBe(1);
    expect((await call('GET', `/animals/${a.json().animalId}`, vet)).json().access).toBe('vet');
  });
  it('scan par boucle RFID ; code inconnu → 404', async () => {
    expect((await call('POST', '/access/scan', vet, { rfid: '0a1b2c3d4e5f' })).statusCode).toBe(200);
    expect((await call('POST', '/access/scan', vet, { code: 'CI-BOV-99999' })).json().code).toBe('animal_not_found');
    expect((await call('POST', '/access/scan', vet, {})).statusCode).toBe(422);
  });
  it('GET /access liste les accès en cours du vétérinaire', async () => {
    const r = (await call('GET', '/access', vet)).json();
    expect(r.items.map((i: any) => i.animal.code)).toEqual(expect.arrayContaining(['CI-BOV-00431', 'CI-BOV-00432']));
    expect((await call('GET', '/access', awa)).statusCode).toBe(403);
  });
  it('l’éleveur invite un vétérinaire vérifié, jamais un non vérifié ni un non-vétérinaire', async () => {
    const cow = await newCow('Invitée');
    expect((await grantTo(cow.id)).statusCode).toBe(201);
    expect((await grantTo(cow.id, unverifiedId)).json().code).toBe('vet_not_verified');
    expect((await grantTo(cow.id, awaId)).statusCode).toBe(422);
    expect((await call('POST', `/animals/${cow.id}/access`, seydou, { vetId })).statusCode).toBe(404);
    expect((await call('POST', `/animals/${cow.id}/access`, vet, { vetId })).statusCode).toBe(403);
  });
  it('le propriétaire liste, retire l’accès ; le vétérinaire ne voit plus l’animal mais l’historique reste (RG3)', async () => {
    const cow = await newCow('Retrait');
    await grantTo(cow.id);
    const ev = await call('POST', `/animals/${cow.id}/health-events`, vet, vaccin({ label: 'Posé par le véto' }));
    expect(ev.statusCode).toBe(201);
    const list = (await call('GET', `/animals/${cow.id}/access`, awa)).json().items;
    expect(list.length).toBe(1);
    expect(list[0].active).toBe(true);
    expect((await call('DELETE', `/animals/${cow.id}/access/${vetId}`, awa)).statusCode).toBe(204);
    expect((await call('DELETE', `/animals/${cow.id}/access/${vetId}`, awa)).statusCode).toBe(404);
    expect((await call('GET', `/animals/${cow.id}`, vet)).statusCode).toBe(404);
    expect((await call('POST', `/animals/${cow.id}/health-events`, vet, vaccin())).statusCode).toBe(404);
    const events = (await call('GET', `/animals/${cow.id}/health-events`, awa)).json().items;
    expect(events.map((e: any) => e.label)).toContain('Posé par le véto');
    expect((await call('GET', `/animals/${cow.id}/access`, awa)).json().items[0].active).toBe(false);
    // un nouveau scan recrée un accès, l'ancienne ligne retirée reste
    expect((await call('POST', '/access/scan', vet, { code: cow.code })).json().created).toBe(true);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM access_grants WHERE animal_id = $1', [cow.id]))[0]!.n).toBe(2);
  });
  it('l’accès expiré ne permet plus rien', async () => {
    const cow = await newCow('Expirée');
    await grantTo(cow.id);
    await ctx.db.query('UPDATE access_grants SET granted_on = current_date - 40, expires_on = current_date - 1 WHERE animal_id = $1', [cow.id]);
    expect((await call('GET', `/animals/${cow.id}/health-events`, vet)).statusCode).toBe(404);
    expect((await call('POST', `/animals/${cow.id}/health-events`, vet, vaccin())).statusCode).toBe(404);
    // le scan le prolonge de nouveau sans doublon
    expect((await call('POST', '/access/scan', vet, { code: cow.code })).json().created).toBe(false);
    expect((await call('GET', `/animals/${cow.id}/health-events`, vet)).statusCode).toBe(200);
  });
  it('les accès sont inscrits au journal d’audit', async () => {
    const n = (await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'access.%'"))[0]!.n;
    expect(n).toBeGreaterThan(3);
  });
});

describe('actes de santé (RG2)', () => {
  let cow: any;
  beforeAll(async () => { cow = await newCow('Dossier'); await grantTo(cow.id); });

  it('l’éleveur déclare un acte (non signé), le vétérinaire en signe un', async () => {
    const own = await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Déclaré éleveur' }));
    expect(own.statusCode).toBe(201);
    expect(own.json().signedByVet).toBe(false);
    expect(own.json().recordedBy.name).toBe('Awa Koné');
    const signed = await call('POST', `/animals/${cow.id}/health-events`, vet, { type: 'soin', label: 'Antibiotique', doneOn: day(0) });
    expect(signed.json().signedByVet).toBe(true);
    expect(signed.json().vet.name).toBe('Dr Yao Kouadio');
  });
  it('un soin du vétérinaire prolonge son accès (RG1)', async () => {
    await ctx.db.query('UPDATE access_grants SET expires_on = current_date + 2 WHERE animal_id = $1', [cow.id]);
    await call('POST', `/animals/${cow.id}/health-events`, vet, { type: 'controle', label: 'Examen', doneOn: day(0) });
    const g = (await ctx.db.query('SELECT expires_on FROM access_grants WHERE animal_id = $1', [cow.id]))[0]!;
    expect(String(g.expires_on instanceof Date ? g.expires_on.toISOString() : g.expires_on).slice(0, 10)).toBe(day(30));
  });
  it('valide les dates et les champs', async () => {
    const post = (b: unknown) => call('POST', `/animals/${cow.id}/health-events`, awa, b);
    expect((await post(vaccin({ doneOn: day(5) }))).statusCode).toBe(422);
    expect((await post(vaccin({ doneOn: day(-5), nextDueOn: day(-10) }))).statusCode).toBe(422);
    expect((await post(vaccin({ doneOn: '16/11/2026' }))).statusCode).toBe(422);
    expect((await post(vaccin({ withdrawalDays: -1 }))).statusCode).toBe(422);
    expect((await post({ type: 'autre', label: 'x', doneOn: day(0) })).statusCode).toBe(422);
  });
  it('agent et autorité lisent mais n’écrivent pas', async () => {
    expect((await call('POST', `/animals/${SEYDOU_COW}/health-events`, agent, vaccin())).statusCode).toBe(403);
    expect((await call('POST', `/animals/${SEYDOU_COW}/health-events`, autorite, vaccin())).statusCode).toBe(403);
    expect((await call('GET', `/animals/${SEYDOU_COW}/health-events`, agent)).statusCode).toBe(200);
  });
  it('un éleveur étranger ne voit pas le dossier', async () => {
    expect((await call('GET', `/animals/${cow.id}/health-events`, seydou)).statusCode).toBe(404);
    expect((await call('POST', `/animals/${cow.id}/health-events`, seydou, vaccin())).statusCode).toBe(404);
  });
  it('le filtre par type fonctionne', async () => {
    const r = (await call('GET', `/animals/${cow.id}/health-events?type=soin`, awa)).json().items;
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e: any) => e.type === 'soin')).toBe(true);
  });
  it('il n’existe aucune route pour modifier ou supprimer un acte', async () => {
    const id = (await call('GET', `/animals/${cow.id}/health-events`, awa)).json().items[0].id;
    expect((await call('PATCH', `/animals/${cow.id}/health-events/${id}`, awa, { label: 'x' })).statusCode).toBe(404);
    expect((await call('DELETE', `/animals/${cow.id}/health-events/${id}`, awa)).statusCode).toBe(404);
  });
  it('une erreur se corrige par un nouvel acte, une seule fois par version', async () => {
    const bad = (await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Erreur de saisie' }))).json();
    const fix = await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Saisie corrigée', correctsEventId: bad.id }));
    expect(fix.statusCode).toBe(201);
    expect(fix.json().correctsEventId).toBe(bad.id);
    const again = await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ correctsEventId: bad.id }));
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('already_corrected');
    const list = (await call('GET', `/animals/${cow.id}/health-events`, awa)).json().items;
    expect(list.find((e: any) => e.id === bad.id).correctedBy).toBe(fix.json().id); // l'original reste visible
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
  it('on ne corrige pas l’acte d’un autre animal ; un vétérinaire ne corrige que les siens', async () => {
    const other = await newCow('Autre');
    const foreign = (await call('POST', `/animals/${other.id}/health-events`, awa, vaccin())).json();
    expect((await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ correctsEventId: foreign.id }))).json().code).toBe('event_not_found');
    const ownerEvent = (await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Éleveur' }))).json();
    expect((await call('POST', `/animals/${cow.id}/health-events`, vet, vaccin({ correctsEventId: ownerEvent.id }))).statusCode).toBe(403);
    const vetEvent = (await call('POST', `/animals/${cow.id}/health-events`, vet, vaccin({ label: 'Véto' }))).json();
    expect((await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ correctsEventId: vetEvent.id }))).statusCode).toBe(201);
  });
  it('un acte échoué n’écrit rien et un rejeu avec Idempotency-Key ne double pas', async () => {
    const h = { 'idempotency-key': 'health-event-0001' };
    const a = await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Une fois' }), h);
    const b = await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Une fois' }), h);
    expect(b.headers['idempotency-replayed']).toBe('true');
    expect(b.json().id).toBe(a.json().id);
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM health_events WHERE label = 'Une fois'"))[0]!.n).toBe(1);
  });
});

describe('délai d’attente (RG6) et rappels', () => {
  it('un délai bloque la vente jusqu’à sa fin ; la correction le lève', async () => {
    const cow = await newCow('Traitée');
    expect((await call('GET', `/animals/${cow.id}/health-summary`, awa)).json().canSell).toBe(true);
    const soin = (await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'Ivermectine', doneOn: day(0), withdrawalDays: 10 })).json();
    expect(soin.withdrawalUntil).toBe(day(10));
    const s = (await call('GET', `/animals/${cow.id}/health-summary`, awa)).json();
    expect(s.canSell).toBe(false);
    expect(s.withdrawalUntil).toBe(day(10));
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'Ivermectine', doneOn: day(0), withdrawalDays: 0, correctsEventId: soin.id });
    expect((await call('GET', `/animals/${cow.id}/health-summary`, awa)).json().canSell).toBe(true);
  });
  it('un délai déjà écoulé ne bloque plus', async () => {
    const cow = await newCow('Ancienne');
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'Vieux soin', doneOn: day(-30), withdrawalDays: 7 });
    expect((await call('GET', `/animals/${cow.id}/health-summary`, awa)).json().canSell).toBe(true);
  });
  it('le délai le plus long l’emporte', async () => {
    const cow = await newCow('Double');
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'A', doneOn: day(0), withdrawalDays: 5 });
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'B', doneOn: day(0), withdrawalDays: 20 });
    expect((await call('GET', `/animals/${cow.id}/health-summary`, awa)).json().withdrawalUntil).toBe(day(20));
  });
  it('rappels : en retard et à venir, seulement la version la plus récente de chaque acte', async () => {
    const cow = await newCow('Calendrier');
    await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Brucellose', doneOn: day(-200), nextDueOn: day(-5) }));
    await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Charbon', doneOn: day(-100), nextDueOn: day(-1) }));
    await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Charbon', doneOn: day(0), nextDueOn: day(10) })); // remplace le précédent
    await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Lointain', doneOn: day(0), nextDueOn: day(200) }));
    const mine = (await call('GET', '/reminders?days=30', awa)).json().items.filter((i: any) => i.animal.id === cow.id);
    expect(mine.map((i: any) => [i.label, i.overdue])).toEqual([['Brucellose', true], ['Charbon', false]]);
    expect(mine[1].dueOn).toBe(day(10));
    const short = (await call('GET', '/reminders?days=5', awa)).json().items.filter((i: any) => i.animal.id === cow.id);
    expect(short.map((i: any) => i.label)).toEqual(['Brucellose']);
    expect((await call('GET', '/reminders?days=500', awa)).statusCode).toBe(422);
  });
  it('les rappels respectent la visibilité', async () => {
    const seyd = (await call('GET', '/reminders?days=365', seydou)).json().items;
    expect(seyd.every((i: any) => i.animal.code === 'CI-BOV-00431')).toBe(true);
    const mine = (await call('GET', '/reminders?days=365', awa)).json().items;
    expect(mine.some((i: any) => i.animal.code === 'CI-BOV-00431')).toBe(false);
  });
  it('un animal retiré (décédé) n’a plus de rappel', async () => {
    const cow = await newCow('Disparue');
    await call('POST', `/animals/${cow.id}/health-events`, awa, vaccin({ label: 'Rappel fantôme', nextDueOn: day(3) }));
    await call('POST', `/animals/${cow.id}/mortality`, awa, { qty: 1 });
    const items = (await call('GET', '/reminders?days=30', awa)).json().items;
    expect(items.some((i: any) => i.label === 'Rappel fantôme')).toBe(false);
  });
});

describe('mortalité (RG5)', () => {
  it('retire de l’effectif et l’inscrit dans l’historique des flux', async () => {
    const lot = await newLot(200);
    const r = await call('POST', `/animals/${lot.id}/mortality`, awa, { qty: 50, cause: 'Chaleur' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ qty: 150, remaining: 150, status: 'actif', deaths: 50 });
    const f = await ctx.db.query("SELECT qty, note FROM flows WHERE animal_id = $1 AND type = 'mortalite'", [lot.id]);
    expect(f).toEqual([{ qty: 50, note: 'Cause : Chaleur' }]);
    expect((await call('GET', `/animals/${lot.id}`, awa)).json()).toMatchObject({ qty: 150, qtyInitial: 200 });
  });
  it('refuse plus que le stock (409) et ne change rien', async () => {
    const lot = await newLot(10);
    const r = await call('POST', `/animals/${lot.id}/mortality`, awa, { qty: 11 });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('qty_exceeds_stock');
    expect((await call('GET', `/animals/${lot.id}`, awa)).json().qty).toBe(10);
  });
  it('un lot vide passe au statut décédé et n’accepte plus rien', async () => {
    const lot = await newLot(5);
    expect((await call('POST', `/animals/${lot.id}/mortality`, awa, { qty: 5 })).json()).toMatchObject({ qty: 0, status: 'decede' });
    expect((await call('POST', `/animals/${lot.id}/mortality`, awa, { qty: 1 })).json().code).toBe('animal_not_active');
  });
  it('un animal seul décède avec qty = 1', async () => {
    const cow = await newCow('Mortelle');
    expect((await call('POST', `/animals/${cow.id}/mortality`, awa, { qty: 2 })).statusCode).toBe(422);
    const r = await call('POST', `/animals/${cow.id}/mortality`, awa, { qty: 1 });
    expect(r.json().status).toBe('decede');
    expect(r.json().qty).toBeNull();
  });
  it('trois déclarations simultanées ne rendent jamais l’effectif négatif', async () => {
    const lot = await newLot(10);
    const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/animals/${lot.id}/mortality`, awa, { qty: 6 })));
    expect(rs.filter((r) => r.statusCode === 201).length).toBe(1);
    expect(rs.filter((r) => r.statusCode === 409).length).toBe(2);
    expect((await call('GET', `/animals/${lot.id}`, awa)).json().qty).toBe(4);
  });
  it('un vétérinaire avec accès peut déclarer ; un agent non', async () => {
    const lot = await newLot(20, 'Lot véto');
    await grantTo(lot.id);
    expect((await call('POST', `/animals/${lot.id}/mortality`, vet, { qty: 1 })).statusCode).toBe(201);
    expect((await call('POST', `/animals/${SEYDOU_COW}/mortality`, agent, { qty: 1 })).statusCode).toBe(403);
  });
  it('RG4 : un animal volé est bloqué pour toute écriture du dossier', async () => {
    const cow = await newCow('Volée');
    await ctx.db.query("UPDATE animals SET status = 'vole' WHERE id = $1", [cow.id]);
    for (const [url, body] of [
      [`/animals/${cow.id}/mortality`, { qty: 1 }],
      [`/animals/${cow.id}/health-events`, vaccin()],
      [`/animals/${cow.id}/cases`, { diseases: ['diarrhée'], affectedCount: 1, severity: 'legere' }],
    ] as const) {
      const r = await call('POST', url, awa, body);
      expect(r.statusCode).toBe(423);
      expect(r.json().code).toBe('animal_locked');
    }
  });
});

describe('signalements de maladie', () => {
  it('ouvre un signalement, marque les maladies à déclaration obligatoire (RG7)', async () => {
    const lot = await newLot(100, 'Bande malade');
    const r = await call('POST', `/animals/${lot.id}/cases`, awa, { diseases: ['Grippe aviaire'], affectedCount: 30, severity: 'grave', symptoms: ['toux', 'plumes ébouriffées'] });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'ouvert', notifiable: true, affectedCount: 30, deaths: 0, symptoms: ['toux', 'plumes ébouriffées'] });
    const banal = await call('POST', `/animals/${lot.id}/cases`, awa, { diseases: ['Diarrhée'], affectedCount: 5, severity: 'legere' });
    expect(banal.json().notifiable).toBe(false);
    const list = (await call('GET', `/animals/${lot.id}/cases`, awa)).json().items;
    expect(list.length).toBe(2);
  });
  it('les maladies s’écrivent avec ou sans accents ni majuscules', async () => {
    const cow = await newCow('Fièvre');
    const r = await call('POST', `/animals/${cow.id}/cases`, awa, { diseases: ['FIEVRE APHTEUSE'], affectedCount: 1, severity: 'grave' });
    expect(r.json().notifiable).toBe(true);
  });
  it('les morts du signalement sortent de l’effectif', async () => {
    const lot = await newLot(100, 'Bande morts');
    const r = await call('POST', `/animals/${lot.id}/cases`, awa, { diseases: ['Newcastle'], affectedCount: 40, deaths: 12, severity: 'grave' });
    expect(r.json().deaths).toBe(12);
    expect((await call('GET', `/animals/${lot.id}`, awa)).json().qty).toBe(88);
    expect((await ctx.db.query("SELECT qty FROM flows WHERE animal_id = $1 AND type = 'mortalite'", [lot.id]))[0]!.qty).toBe(12);
  });
  it('contrôles de cohérence', async () => {
    const lot = await newLot(10, 'Petit lot');
    const cow = await newCow('Seule');
    const post = (id: string, b: unknown) => call('POST', `/animals/${id}/cases`, awa, b);
    const base = { diseases: ['Toux'], severity: 'moyenne' };
    expect((await post(lot.id, { ...base, affectedCount: 11 })).json().code).toBe('qty_exceeds_stock');
    expect((await post(lot.id, { ...base, affectedCount: 3, deaths: 4 })).statusCode).toBe(422);
    expect((await post(cow.id, { ...base, affectedCount: 2 })).statusCode).toBe(422);
    expect((await post(cow.id, { ...base, diseases: [], affectedCount: 1 })).statusCode).toBe(422);
    expect((await post(cow.id, { ...base, severity: 'critique', affectedCount: 1 })).statusCode).toBe(422);
  });
  it('un signalement dont la mortalité échoue n’est pas enregistré (transaction)', async () => {
    const cow = await newCow('Déjà morte');
    await call('POST', `/animals/${cow.id}/mortality`, awa, { qty: 1 });
    const r = await call('POST', `/animals/${cow.id}/cases`, awa, { diseases: ['Toux'], affectedCount: 1, severity: 'grave', deaths: 1 });
    expect(r.statusCode).toBe(409);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM cases WHERE animal_id = $1', [cow.id]))[0]!.n).toBe(0);
  });
  it('un vétérinaire avec accès ouvre et suit un signalement ; l’étranger a 404', async () => {
    const cow = await newCow('Suivie');
    await grantTo(cow.id);
    const c = (await call('POST', `/animals/${cow.id}/cases`, vet, { diseases: ['Mammite'], affectedCount: 1, severity: 'moyenne' })).json();
    expect(c.openedBy.name).toBe('Dr Yao Kouadio');
    expect((await call('PATCH', `/cases/${c.id}`, seydou, { status: 'suivi' })).statusCode).toBe(404);
    expect((await call('PATCH', `/cases/${c.id}`, agent, { status: 'suivi' })).statusCode).toBe(404);
  });
  it('le suivi avance dans l’ordre et se termine', async () => {
    const cow = await newCow('Guérison');
    const c = (await call('POST', `/animals/${cow.id}/cases`, awa, { diseases: ['Mammite'], affectedCount: 1, severity: 'legere' })).json();
    const s = await call('PATCH', `/cases/${c.id}`, awa, { status: 'suivi', note: 'Traitée' });
    expect(s.json()).toMatchObject({ status: 'suivi', note: 'Traitée', closedOn: null });
    const g = await call('PATCH', `/cases/${c.id}`, awa, { status: 'gueri' });
    expect(g.json().status).toBe('gueri');
    expect(g.json().closedOn).toBe(day(0));
    expect((await call('PATCH', `/cases/${c.id}`, awa, { status: 'suivi' })).json().code).toBe('invalid_transition');
    expect((await call('PATCH', `/cases/${c.id}`, awa, { status: 'clos' })).json().status).toBe('clos');
    expect((await call('PATCH', `/cases/${c.id}`, awa, { status: 'gueri' })).statusCode).toBe(409);
    expect((await call('PATCH', `/cases/${c.id}`, awa, {})).statusCode).toBe(422);
    expect((await call('PATCH', '/cases/11111111-1111-4111-8111-111111111111', awa, { status: 'suivi' })).statusCode).toBe(404);
  });
});
