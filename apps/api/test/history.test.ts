import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let awa: string, seydou: string, vet: string, autorite: string;
let awaId: string, seydouId: string;

const call = (method: string, url: string, token: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: bearer(token) });
const today = new Date().toISOString().slice(0, 10);
const newCow = async (name: string, token = awa) => (await call('POST', '/animals', token, { species: 'bovin', kind: 'individual', name })).json();

beforeAll(async () => {
  ctx = await setup();
  const a = (await login(ctx.app, '0712345678')).body; awa = a.accessToken; awaId = a.user.id;
  const s = (await login(ctx.app, '0723456789')).body; seydou = s.accessToken; seydouId = s.user.id;
  vet = (await login(ctx.app, '0501020304')).body.accessToken;
  autorite = (await login(ctx.app, '0505050505')).body.accessToken;
});
afterAll(async () => { await ctx.close(); });

describe('cheptel complet et archive (ancien propriétaire)', () => {
  let cow: any, sold: any, transferEnd: string;

  beforeAll(async () => {
    cow = await newCow('Transférée');
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'vaccin', label: 'Charbon', doneOn: today });
    await call('POST', `/animals/${cow.id}/cases`, awa, { diseases: ['fièvre aphteuse'], affectedCount: 1, severity: 'moyenne', symptoms: ['fièvre'] });
    expect((await call('POST', `/animals/${cow.id}/transfer`, awa, { toUserId: seydouId })).statusCode).toBe(201);
    await call('POST', `/animals/${cow.id}/health-events`, seydou, { type: 'controle', label: 'Contrôle du nouveau propriétaire', doneOn: today });
    sold = await newCow('Vendue');
    await call('POST', `/animals/${sold.id}/sale`, awa, { counterpart: 'Marché', price: 100000 });
    transferEnd = today;
  });

  it('la fiche normale n’est plus accessible à l’ancien propriétaire', async () => {
    expect((await call('GET', `/animals/${cow.id}`, awa)).statusCode).toBe(404);
  });

  it('GET /animals sans scope : ni les transférés', async () => {
    const items = (await call('GET', '/animals?limit=100', awa)).json().items;
    expect(items.some((a: any) => a.id === cow.id)).toBe(false);
  });

  it('scope=all : transférés et vendus, avec relation et sortie ; nouveau propriétaire masqué', async () => {
    const r = (await call('GET', '/animals?scope=all&limit=100', awa)).json();
    const t = r.items.find((a: any) => a.id === cow.id);
    expect(t).toMatchObject({ relation: 'former', exit: { type: 'transfert', on: transferEnd }, owner: { id: '', name: 'Un autre éleveur' } });
    expect(r.items.find((a: any) => a.id === sold.id)).toMatchObject({ relation: 'owner', exit: { type: 'vente' } });
  });

  it('filtres de sortie', async () => {
    const q = (s: string) => call('GET', `/animals?scope=all&limit=100&${s}`, awa).then((r) => r.json());
    expect((await q('exited=true')).items.every((a: any) => a.exit)).toBe(true);
    expect((await q('exitFrom=2020-01-01&exitTo=2020-12-31')).total).toBe(0);
    expect((await q(`exitFrom=${today}&exitTo=${today}`)).total).toBeGreaterThanOrEqual(2);
    expect((await q('sort=exit&order=asc')).items.length).toBeGreaterThan(0);
  });

  it('dates invalides ou inversées → 422', async () => {
    expect((await call('GET', '/animals?createdFrom=2026-02-01&createdTo=2026-01-01', awa)).statusCode).toBe(422);
    expect((await call('GET', '/animals?createdFrom=hier', awa)).statusCode).toBe(422);
    expect((await call('GET', '/me/history?from=2026-02-01&to=2026-01-01', awa)).statusCode).toBe(422);
  });

  it('archive : dossier figé, en lecture seule, sans ce que fait le nouveau propriétaire', async () => {
    const r = await call('GET', `/animals/${cow.id}/archive`, awa);
    expect(r.statusCode).toBe(200);
    const a = r.json();
    expect(a).toMatchObject({ readOnly: true, exit: { type: 'transfert' } });
    expect(a.events.map((e: any) => e.label)).toEqual(['Charbon']);
    expect(a.cases).toHaveLength(1);
    expect(a.animal.owner).toBeUndefined();
    expect(a.animal.zone).toBeUndefined();
    expect(a.animal.qty).toBeUndefined();
  });

  it('archive : réservée à l’ancien propriétaire', async () => {
    expect((await call('GET', `/animals/${cow.id}/archive`, seydou)).statusCode).toBe(404);
    expect((await call('GET', `/animals/${cow.id}/archive`, vet)).statusCode).toBe(404);
    expect((await call('GET', `/animals/${cow.id}/archive`, autorite)).statusCode).toBe(404);
    expect((await call('GET', `/animals/${sold.id}/archive`, awa)).statusCode).toBe(404);
  });

  it('l’ancien propriétaire ne peut rien modifier', async () => {
    expect((await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'X', doneOn: today })).statusCode).toBe(404);
    expect((await call('PATCH', `/animals/${cow.id}`, awa, { name: 'Volée' })).statusCode).toBe(404);
  });
});

describe('journal du compte', () => {
  it('exige une connexion et valide les paramètres', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/me/history' })).statusCode).toBe(401);
    expect((await call('GET', '/me/history?category=nimporte', awa)).statusCode).toBe(422);
    expect((await call('GET', '/me/history?limit=1000', awa)).statusCode).toBe(422);
  });

  it('contient les connexions, avec phrase lisible, du plus récent au plus ancien', async () => {
    const r = (await call('GET', '/me/history', awa)).json();
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.some((e: any) => e.action === 'auth.login' && e.label === 'Connexion' && e.category === 'compte')).toBe(true);
    const dates = r.items.map((e: any) => e.at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('catégories, animal, recherche, jour précis, tri et pagination', async () => {
    const q = (s: string) => call('GET', `/me/history?${s}`, awa).then((r) => r.json());
    const mouv = await q('category=mouvement');
    expect(mouv.items.map((e: any) => e.label)).toEqual(expect.arrayContaining(['Transfert de propriété']));
    expect(mouv.items.every((e: any) => e.category === 'mouvement')).toBe(true);
    expect((await q('category=sante')).items.some((e: any) => e.label.includes('Charbon'))).toBe(true);
    expect((await q('q=charbon')).total).toBeGreaterThanOrEqual(1);
    expect((await q(`from=${today}&to=${today}`)).total).toBe((await q('')).total);
    expect((await q('from=2020-01-01&to=2020-01-02')).total).toBe(0);
    const p = await q('limit=2&page=2');
    expect(p.items).toHaveLength(2);
    const asc = await q('order=asc&limit=100');
    expect(asc.items[0].at <= asc.items[asc.items.length - 1].at).toBe(true);
    expect((await q('mine=true')).items.every((e: any) => e.byMe)).toBe(true);
  });

  it('l’ancien propriétaire ne voit pas ce que fait le nouveau après le transfert', async () => {
    const r = (await call('GET', '/me/history?limit=100', awa)).json();
    expect(r.items.some((e: any) => e.label.includes('nouveau propriétaire'))).toBe(false);
    const s = (await call('GET', '/me/history?limit=100', seydou)).json();
    expect(s.items.some((e: any) => e.actor?.id === seydouId && e.category === 'sante')).toBe(true);
  });

  it('le vétérinaire ne voit que ses propres actions', async () => {
    const r = (await call('GET', '/me/history?limit=100', vet)).json();
    expect(r.items.every((e: any) => e.byMe)).toBe(true);
  });

  it('export CSV du journal', async () => {
    const r = await call('GET', '/export/history.csv?category=compte', awa);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.body.split('\n')[0]).toContain('date');
    expect(r.body).toContain('Connexion');
  });
});

describe('filtres des listes d’un animal', () => {
  it('actes : type, texte, période, signature, tri', async () => {
    const cow = await newCow('Filtrée');
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'vaccin', label: 'Brucellose', doneOn: '2026-01-10' });
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'Vermifuge', doneOn: '2026-03-10' });
    const q = (s: string) => call('GET', `/animals/${cow.id}/health-events?${s}`, awa).then((r) => r.json().items);
    expect(await q('type=vaccin')).toHaveLength(1);
    expect(await q('q=vermi')).toHaveLength(1);
    expect(await q('from=2026-02-01&to=2026-12-31')).toHaveLength(1);
    expect(await q('signed=true')).toHaveLength(0);
    expect((await q('order=asc'))[0].label).toBe('Brucellose');
    expect((await call('GET', `/animals/${cow.id}/health-events?from=2026-05-01&to=2026-01-01`, awa)).statusCode).toBe(422);
  });

  it('mouvements et cas : filtres', async () => {
    const cow = await newCow('Mouvements');
    await call('POST', `/animals/${cow.id}/cases`, awa, { diseases: ['fièvre aphteuse'], affectedCount: 1, severity: 'legere' });
    expect((await call('GET', `/animals/${cow.id}/cases?q=aphteuse`, awa)).json().items).toHaveLength(1);
    expect((await call('GET', `/animals/${cow.id}/cases?status=gueri`, awa)).json().items).toHaveLength(0);
    await call('POST', `/animals/${cow.id}/sale`, awa, { counterpart: 'Boucherie Yao' });
    expect((await call('GET', `/animals/${cow.id}/flows?type=vente&q=yao`, awa)).json().items).toHaveLength(1);
    expect((await call('GET', `/animals/${cow.id}/flows?from=2099-01-01`, awa)).json().items).toHaveLength(0);
  });

  it('liste des animaux : délai d’attente, cas ouvert, créés entre deux dates', async () => {
    const cow = await newCow('Soignée');
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'Antibiotique', doneOn: today, withdrawalDays: 7 });
    const q = (s: string) => call('GET', `/animals?limit=100&${s}`, awa).then((r) => r.json());
    expect((await q('withdrawal=true')).items.some((a: any) => a.id === cow.id)).toBe(true);
    expect((await q('withdrawal=false')).items.some((a: any) => a.id === cow.id)).toBe(false);
    expect((await q(`createdFrom=${today}&createdTo=${today}`)).items.some((a: any) => a.id === cow.id)).toBe(true);
    expect((await q('createdTo=2020-01-01')).total).toBe(0);
  });
});
