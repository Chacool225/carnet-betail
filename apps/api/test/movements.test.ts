import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let awa: string, seydou: string, vet: string, agent: string, autorite: string;
let awaId: string, seydouId: string, vetId: string;

const call = (method: string, url: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { ...bearer(token), ...headers } });
const day = (o = 0) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
const newCow = async (name = 'Vache', token = awa) => (await call('POST', '/animals', token, { species: 'bovin', kind: 'individual', name })).json();
const newLot = async (qty: number, name = 'Lot') => (await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name, qty })).json();
const get = async (id: string, token = awa) => (await call('GET', `/animals/${id}`, token)).json();

beforeAll(async () => {
  ctx = await setup();
  const a = (await login(ctx.app, '0712345678')).body; awa = a.accessToken; awaId = a.user.id;
  const s = (await login(ctx.app, '0723456789')).body; seydou = s.accessToken; seydouId = s.user.id;
  const v = (await login(ctx.app, '0501020304')).body; vet = v.accessToken; vetId = v.user.id;
  agent = (await login(ctx.app, '0102030405')).body.accessToken;
  autorite = (await login(ctx.app, '0505050505')).body.accessToken;
});
afterAll(async () => { await ctx.close(); });

describe('vente', () => {
  it('vend un animal seul : statut vendu, flux enregistré', async () => {
    const cow = await newCow('À vendre');
    const r = await call('POST', `/animals/${cow.id}/sale`, awa, { counterpart: 'Marché de Korhogo', price: 350000 });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ sold: 1, status: 'vendu' });
    const flows = (await call('GET', `/animals/${cow.id}/flows`, awa)).json().items;
    expect(flows[0]).toMatchObject({ type: 'vente', qty: 1, counterpart: 'Marché de Korhogo', note: 'Prix : 350000 FCFA' });
    expect((await call('POST', `/animals/${cow.id}/sale`, awa, {})).json().code).toBe('animal_not_active');
  });
  it('vente partielle d’un lot', async () => {
    const lot = await newLot(100);
    const r = await call('POST', `/animals/${lot.id}/sale`, awa, { qty: 30, counterpart: 'Restaurant' });
    expect(r.json()).toMatchObject({ sold: 30, qty: 70, status: 'actif' });
    expect((await call('POST', `/animals/${lot.id}/sale`, awa, { qty: 71 })).json().code).toBe('qty_exceeds_stock');
    expect((await get(lot.id)).qty).toBe(70);
  });
  it('vente du reste d’un lot : effectif 0 et statut vendu', async () => {
    const lot = await newLot(10);
    expect((await call('POST', `/animals/${lot.id}/sale`, awa, {})).json()).toMatchObject({ sold: 10, qty: 0, status: 'vendu' });
  });
  it('RG6 : la vente est refusée pendant un délai d’attente, autorisée après correction', async () => {
    const cow = await newCow('Traitée');
    const soin = (await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'Antibiotique', doneOn: day(0), withdrawalDays: 7 })).json();
    const r = await call('POST', `/animals/${cow.id}/sale`, awa, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('withdrawal_active');
    expect(r.json().details.until).toBe(day(7));
    expect((await call('POST', `/animals/${cow.id}/slaughter`, awa, {})).json().code).toBe('withdrawal_active');
    expect((await call('POST', `/animals/${cow.id}/listing`, awa, { price: 1000 })).json().code).toBe('withdrawal_active');
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'Antibiotique', doneOn: day(0), withdrawalDays: 0, correctsEventId: soin.id });
    expect((await call('POST', `/animals/${cow.id}/sale`, awa, {})).statusCode).toBe(201);
  });
  it('vente à un éleveur inscrit : transfert, historique conservé, accès vétérinaires retirés (RG3)', async () => {
    const cow = await newCow('Transférée');
    await call('POST', `/animals/${cow.id}/access`, awa, { vetId });
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'vaccin', label: 'Charbon', doneOn: day(-2) });
    const r = await call('POST', `/animals/${cow.id}/sale`, awa, { buyerId: seydouId, price: 200000 });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'actif', ownerId: seydouId });
    expect(r.json().transferId).toBeTruthy();
    expect((await call('GET', `/animals/${cow.id}`, awa)).statusCode).toBe(404);
    const now = await get(cow.id, seydou);
    expect(now.owner.name).toBe('Seydou Traoré');
    expect(now.zone.name).toBe('Ferkessédougou'); // la zone suit le nouvel éleveur
    const events = (await call('GET', `/animals/${cow.id}/health-events`, seydou)).json().items;
    expect(events.map((e: any) => e.label)).toContain('Charbon'); // l'historique suit l'animal
    expect((await call('GET', `/animals/${cow.id}`, vet)).statusCode).toBe(404); // accès vétérinaire retiré
    const t = await ctx.db.query('SELECT from_user, to_user FROM transfers WHERE animal_id = $1', [cow.id]);
    expect(t).toEqual([{ from_user: awaId, to_user: seydouId }]);
    const flows = (await call('GET', `/animals/${cow.id}/flows`, seydou)).json().items;
    expect(flows.find((f: any) => f.type === 'vente').counterpart).toBe('Seydou Traoré');
  });
  it('les transferts ne se modifient ni ne se suppriment', async () => {
    await expect(ctx.db.query('DELETE FROM transfers')).rejects.toThrow();
    await expect(ctx.db.query("UPDATE transfers SET occurred_on = '2020-01-01'")).rejects.toThrow();
  });
  it('acheteur invalide ou vente partielle avec acheteur inscrit', async () => {
    const cow = await newCow('Acheteurs');
    expect((await call('POST', `/animals/${cow.id}/sale`, awa, { buyerId: vetId })).statusCode).toBe(422); // pas un éleveur
    expect((await call('POST', `/animals/${cow.id}/sale`, awa, { buyerId: awaId })).statusCode).toBe(422); // soi-même
    expect((await call('POST', `/animals/${cow.id}/sale`, awa, { buyerId: '11111111-1111-4111-8111-111111111111' })).statusCode).toBe(422);
    expect((await get(cow.id)).status).toBe('actif'); // rien n'a été écrit
    expect((await ctx.db.query("SELECT 1 FROM flows WHERE animal_id = $1 AND type = 'vente'", [cow.id])).length).toBe(0);
    const lot = await newLot(10);
    expect((await call('POST', `/animals/${lot.id}/sale`, awa, { qty: 3, buyerId: seydouId })).statusCode).toBe(422);
  });
  it('seul le propriétaire vend', async () => {
    const cow = await newCow('Pas à toi');
    expect((await call('POST', `/animals/${cow.id}/sale`, seydou, {})).statusCode).toBe(404);
    expect((await call('POST', `/animals/00000000-0000-4000-8000-0000000001a1/sale`, vet, {})).statusCode).toBe(403);
    expect((await call('POST', `/animals/00000000-0000-4000-8000-0000000001a1/sale`, agent, {})).statusCode).toBe(403);
  });
  it('rejoue une vente avec la même Idempotency-Key sans la refaire', async () => {
    const lot = await newLot(50);
    const h = { 'idempotency-key': 'sale-0000-0001' };
    await call('POST', `/animals/${lot.id}/sale`, awa, { qty: 10 }, h);
    const again = await call('POST', `/animals/${lot.id}/sale`, awa, { qty: 10 }, h);
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect((await get(lot.id)).qty).toBe(40);
  });
  it('refuse une date future', async () => {
    const cow = await newCow('Futur');
    expect((await call('POST', `/animals/${cow.id}/sale`, awa, { occurredOn: day(3) })).statusCode).toBe(422);
  });
});

describe('abattage', () => {
  it('abat un animal seul et une partie d’un lot', async () => {
    const cow = await newCow('Abattue');
    expect((await call('POST', `/animals/${cow.id}/slaughter`, awa, { note: 'Fête' })).json()).toMatchObject({ slaughtered: 1, status: 'abattu' });
    const lot = await newLot(40);
    expect((await call('POST', `/animals/${lot.id}/slaughter`, awa, { qty: 15 })).json()).toMatchObject({ slaughtered: 15, qty: 25, status: 'actif' });
    expect((await call('POST', `/animals/${lot.id}/slaughter`, awa, { qty: 26 })).json().code).toBe('qty_exceeds_stock');
    expect((await ctx.db.query("SELECT qty FROM flows WHERE animal_id = $1 AND type = 'abattage'", [lot.id]))[0]!.qty).toBe(15);
  });
});

describe('transfert', () => {
  it('donne un animal à un autre éleveur', async () => {
    const cow = await newCow('Cadeau');
    const r = await call('POST', `/animals/${cow.id}/transfer`, awa, { toUserId: seydouId, note: 'Héritage' });
    expect(r.statusCode).toBe(201);
    expect((await get(cow.id, seydou)).owner.id).toBe(seydouId);
    expect((await call('POST', `/animals/${cow.id}/transfer`, awa, { toUserId: seydouId })).statusCode).toBe(404);
  });
});

describe('vol (RG4)', () => {
  it('la déclaration bloque la fiche, crée une alerte haute et retire l’annonce', async () => {
    const cow = await newCow('Volée');
    await call('POST', `/animals/${cow.id}/listing`, awa, { price: 100000 });
    const r = await call('POST', `/animals/${cow.id}/theft`, awa, { note: 'Disparue du pâturage' });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('vole');
    const a = await get(cow.id);
    expect(a.status).toBe('vole');
    const alert = (await ctx.db.query("SELECT * FROM alerts WHERE id = $1", [r.json().alertId]))[0]!;
    expect(alert).toMatchObject({ kind: 'vol', severity: 'haute' });
    expect((await call('GET', '/market', seydou)).json().items.some((i: any) => i.id === cow.id)).toBe(false);
    for (const [url, body] of [[`/animals/${cow.id}/sale`, {}], [`/animals/${cow.id}/slaughter`, {}], [`/animals/${cow.id}/transfer`, { toUserId: seydouId }], [`/animals/${cow.id}/listing`, { price: 1 }], [`/animals/${cow.id}/theft`, {}]] as const) {
      const x = await call('POST', url, awa, body);
      expect(x.statusCode).toBe(423);
    }
    expect((await call('PATCH', `/animals/${cow.id}`, awa, { name: 'Autre' })).statusCode).toBe(423);
    expect((await call('GET', `/animals/lookup?code=${cow.code}`, vet)).json().stolen).toBe(true);
  });
  it('retrouvé : déblocage par le propriétaire, un agent de la zone ou l’autorité, et alerte clôturée', async () => {
    const cow = await newCow('Retrouvée');
    await call('POST', `/animals/${cow.id}/theft`, awa, {});
    expect((await call('POST', `/animals/${cow.id}/recovery`, seydou, {})).statusCode).toBe(404);
    const r = await call('POST', `/animals/${cow.id}/recovery`, autorite, { note: 'Retrouvée à Sinématiali' });
    expect(r.json().status).toBe('actif');
    expect((await get(cow.id)).status).toBe('actif');
    expect((await ctx.db.query("SELECT handled_at FROM alerts WHERE animal_id = $1 AND kind = 'vol'", [cow.id]))[0]!.handled_at).not.toBeNull();
    expect((await call('POST', `/animals/${cow.id}/recovery`, awa, {})).json().code).toBe('not_stolen');
    expect((await call('PATCH', `/animals/${cow.id}`, awa, { name: 'Débloquée' })).statusCode).toBe(200);
  });
  it('un vétérinaire ne lève pas le blocage', async () => {
    const cow = await newCow('Véto');
    await call('POST', `/animals/${cow.id}/access`, awa, { vetId });
    await call('POST', `/animals/${cow.id}/theft`, awa, {});
    expect((await call('POST', `/animals/${cow.id}/recovery`, vet, {})).statusCode).toBe(403);
  });
  it('seul un animal actif peut être déclaré volé', async () => {
    const cow = await newCow('Déjà vendue');
    await call('POST', `/animals/${cow.id}/sale`, awa, {});
    expect((await call('POST', `/animals/${cow.id}/theft`, awa, {})).json().code).toBe('animal_not_active');
  });
});

describe('marché', () => {
  let cow: any;
  beforeAll(async () => { cow = await newCow('En vitrine'); });

  it('mise en vente puis retrait', async () => {
    expect((await call('POST', `/animals/${cow.id}/listing`, awa, { price: 450000 })).json()).toMatchObject({ listed: true, price: 450000 });
    expect((await call('GET', '/market?q=vitrine', seydou)).json().items[0]).toMatchObject({ name: 'En vitrine', price: 450000, ownerName: 'Awa Koné' });
    expect((await call('DELETE', `/animals/${cow.id}/listing`, awa)).statusCode).toBe(204);
    expect((await call('DELETE', `/animals/${cow.id}/listing`, awa)).json().code).toBe('not_listed');
    expect((await call('GET', '/market?q=vitrine', seydou)).json().total).toBe(0);
  });
  it('l’annonce ne révèle ni boucle RFID, ni coordonnées', async () => {
    await call('POST', `/animals/${cow.id}/listing`, awa, { price: 1000 });
    const item = (await call('GET', '/market?q=vitrine', seydou)).json().items[0];
    expect(item).not.toHaveProperty('rfid');
    expect(JSON.stringify(item)).not.toMatch(/0712345678|awa@demo/);
  });
  it('filtres et tri par prix', async () => {
    const a = await newCow('Bétail Pas cher'); const b = await newCow('Bétail Cher');
    await call('POST', `/animals/${a.id}/listing`, awa, { price: 100 });
    await call('POST', `/animals/${b.id}/listing`, awa, { price: 900 });
    const asc = (await call('GET', '/market?q=B%C3%A9tail&sort=price&order=asc', seydou)).json().items.map((i: any) => i.price);
    expect(asc).toEqual([100, 900]);
    expect((await call('GET', '/market?q=B%C3%A9tail&minPrice=500', seydou)).json().items.map((i: any) => i.name)).toEqual(['Bétail Cher']);
    expect((await call('GET', '/market?q=B%C3%A9tail&maxPrice=500&species=volaille', seydou)).json().total).toBe(0);
    expect((await call('GET', '/market?limit=500', seydou)).statusCode).toBe(422);
  });
  it('un animal vendu, abattu ou en délai d’attente disparaît du marché', async () => {
    const c = await newCow('Disparait');
    await call('POST', `/animals/${c.id}/listing`, awa, { price: 5 });
    await call('POST', `/animals/${c.id}/health-events`, awa, { type: 'soin', label: 'Traitement', doneOn: day(0), withdrawalDays: 3 });
    expect((await call('GET', '/market?q=Disparait', seydou)).json().total).toBe(0); // délai ajouté après la mise en vente
    const d = await newCow('Disparait 2');
    await call('POST', `/animals/${d.id}/listing`, awa, { price: 5 });
    await call('POST', `/animals/${d.id}/sale`, awa, {});
    expect((await call('GET', '/market?q=Disparait%202', seydou)).json().total).toBe(0);
    expect((await get(d.id)).status).toBe('vendu');
  });
  it('seul le propriétaire met en vente', async () => {
    expect((await call('POST', `/animals/${cow.id}/listing`, seydou, { price: 1 })).statusCode).toBe(404);
    expect((await call('POST', `/animals/${cow.id}/listing`, awa, { price: -5 })).statusCode).toBe(422);
  });
  it('le marché exige une connexion', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/market' })).statusCode).toBe(401);
  });
});
