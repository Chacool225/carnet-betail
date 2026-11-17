import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let awa: string, seydou: string, vet: string, agent: string, autorite: string;
const call = (method: string, url: string, token: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: bearer(token) });
const lot = async (token: string, name: string, qty = 50, zoneId?: string) =>
  (await call('POST', '/animals', token, { species: 'volaille', kind: 'lot', name, qty, ...(zoneId ? { zoneId } : {}) })).json();

beforeAll(async () => {
  ctx = await setup();
  awa = (await login(ctx.app, '0712345678')).body.accessToken;
  seydou = (await login(ctx.app, '0723456789')).body.accessToken;
  vet = (await login(ctx.app, '0501020304')).body.accessToken;
  agent = (await login(ctx.app, '0102030405')).body.accessToken;
  autorite = (await login(ctx.app, '0505050505')).body.accessToken;
});
afterAll(async () => { await ctx.close(); });

describe('alertes automatiques', () => {
  it('RG7 : une maladie à déclaration obligatoire crée une alerte haute visible de l’autorité', async () => {
    const l = await lot(awa, 'Bande grippe');
    await call('POST', `/animals/${l.id}/cases`, awa, { diseases: ['Grippe aviaire'], affectedCount: 10, severity: 'grave' });
    const items = (await call('GET', '/alerts?kind=sanitaire', autorite)).json().items;
    const a = items.find((i: any) => i.title.includes('grippe aviaire') || i.title.includes('Grippe aviaire'));
    expect(a).toBeTruthy();
    expect(a.severity).toBe('haute');
    expect(a.zone.name).toBe('Korhogo');
    expect(a.animal.code).toBe(l.code);
    expect(a.handled).toBe(false);
  });
  it('une maladie ordinaire isolée ne crée pas d’alerte', async () => {
    const before = (await call('GET', '/alerts', autorite)).json().total;
    const l = await lot(awa, 'Bande toux');
    await call('POST', `/animals/${l.id}/cases`, awa, { diseases: ['Toux'], affectedCount: 3, severity: 'legere' });
    expect((await call('GET', '/alerts', autorite)).json().total).toBe(before);
  });
  it('foyer suspect : trois élevages de la zone touchés par la même maladie, une seule alerte', async () => {
    const before = (await call('GET', '/alerts?kind=sanitaire', autorite)).json().total;
    for (const n of ['F1', 'F2', 'F3', 'F4']) {
      const l = await lot(awa, `Foyer ${n}`);
      await call('POST', `/animals/${l.id}/cases`, awa, { diseases: ['Diarrhée blanche'], affectedCount: 4, severity: 'moyenne' });
      const total = (await call('GET', '/alerts?kind=sanitaire', autorite)).json().total;
      if (n === 'F1' || n === 'F2') expect(total).toBe(before);
      else expect(total).toBe(before + 1); // créée au 3e, pas doublée au 4e
    }
    const foyer = (await call('GET', '/alerts?kind=sanitaire', autorite)).json().items.find((i: any) => i.title === 'Foyer suspect : diarrhée blanche');
    expect(foyer.severity).toBe('moyenne');
    expect(foyer.why).toMatch(/3 élevages|4 élevages/);
  });
  it('forte mortalité dans un lot : anomalie', async () => {
    const l = await lot(awa, 'Bande fragile', 100);
    await call('POST', `/animals/${l.id}/mortality`, awa, { qty: 5 });
    expect((await call('GET', '/alerts?kind=anomalie', autorite)).json().items.some((i: any) => i.animal?.id === l.id)).toBe(false);
    await call('POST', `/animals/${l.id}/mortality`, awa, { qty: 30 });
    expect((await call('GET', '/alerts?kind=anomalie', autorite)).json().items.some((i: any) => i.animal?.id === l.id)).toBe(true);
  });
});

describe('visibilité des alertes', () => {
  let stolenId: string;
  beforeAll(async () => {
    stolenId = (await lot(awa, 'Bande volée')).id;
    await call('POST', `/animals/${stolenId}/theft`, awa, {});
  });
  it('un agent ne voit pas les vols d’une autre zone', async () => {
    const items = (await call('GET', '/alerts?kind=vol', agent)).json().items;
    // l'agent est à Ferkessédougou : la bande d'Awa est à Korhogo
    expect(items.some((i: any) => i.animal?.id === stolenId)).toBe(false);
  });
  it('le propriétaire voit son alerte ; un autre éleveur ne voit pas les vols', async () => {
    expect((await call('GET', '/alerts?kind=vol', awa)).json().items.some((i: any) => i.animal?.id === stolenId)).toBe(true);
    expect((await call('GET', '/alerts?kind=vol', seydou)).json().total).toBe(0);
  });
  it('les alertes sanitaires de la zone sont visibles des autres éleveurs, sans l’animal', async () => {
    const korhogo = (await call('GET', '/zones', awa)).json().items.find((z: any) => z.name === 'Korhogo').id;
    await ctx.db.query("UPDATE users SET zone_id = $1 WHERE phone = '0723456789'", [korhogo]);
    const items = (await call('GET', '/alerts?kind=sanitaire', seydou)).json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i: any) => i.animal === null)).toBe(true);
    expect(items.every((i: any) => i.zone.name === 'Korhogo')).toBe(true);
    await ctx.db.query("UPDATE users SET zone_id = (SELECT id FROM zones WHERE name = 'Ferkessédougou') WHERE phone = '0723456789'");
  });
  it('l’autorité voit tout, le tri met les alertes hautes non traitées en premier', async () => {
    const items = (await call('GET', '/alerts?limit=100', autorite)).json().items;
    expect(items[0].severity).toBe('haute');
    expect(items[0].handled).toBe(false);
  });
  it('filtre handled', async () => {
    expect((await call('GET', '/alerts?handled=true', autorite)).json().items.every((i: any) => i.handled)).toBe(true);
    expect((await call('GET', '/alerts?kind=autre', autorite)).statusCode).toBe(422);
  });
});

describe('prise en charge', () => {
  it('l’autorité prend en charge une alerte une seule fois ; éleveur et vétérinaire ne le peuvent pas', async () => {
    const a = (await call('GET', '/alerts?handled=false', autorite)).json().items[0];
    expect((await call('PATCH', `/alerts/${a.id}/handle`, awa)).statusCode).toBe(403);
    expect((await call('PATCH', `/alerts/${a.id}/handle`, vet)).statusCode).toBe(403);
    const r = await call('PATCH', `/alerts/${a.id}/handle`, autorite);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ handled: true, handledBy: 'Direction des services vétérinaires' });
    expect((await call('PATCH', `/alerts/${a.id}/handle`, autorite)).json().code).toBe('already_handled');
    expect((await call('PATCH', '/alerts/11111111-1111-4111-8111-111111111111/handle', autorite)).statusCode).toBe(404);
  });
  it('un agent ne traite que les alertes de sa zone', async () => {
    const mine = await lot(seydou, 'Bande Ferké');
    await call('POST', `/animals/${mine.id}/theft`, seydou, {});
    const items = (await call('GET', '/alerts?kind=vol&handled=false', agent)).json().items;
    const a = items.find((i: any) => i.animal?.id === mine.id);
    expect(a).toBeTruthy();
    expect((await call('PATCH', `/alerts/${a.id}/handle`, agent)).statusCode).toBe(200);
    const other = (await call('GET', '/alerts?handled=false', autorite)).json().items.find((i: any) => i.zone?.name === 'Korhogo');
    expect((await call('PATCH', `/alerts/${other.id}/handle`, agent)).statusCode).toBe(404);
  });
});

describe('tableau de bord de l’agent', () => {
  it('résume sa zone', async () => {
    const r = (await call('GET', '/agent/overview', agent)).json();
    expect(r.zone.name).toBe('Ferkessédougou');
    expect(r.animals).toBeGreaterThanOrEqual(1);
    expect(r.stolen).toBeGreaterThanOrEqual(1);
    expect(typeof r.unhandledAlerts).toBe('number');
    expect((await call('GET', '/agent/overview', awa)).statusCode).toBe(403);
  });
});
