import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, setup, type TestCtx } from './helpers.js';
import { login } from './helpers.js';
import { createReminderNotifications } from '../src/jobs/reminders.js';

let ctx: TestCtx;
let awa: string, seydou: string, koffi: string, koffiId: string, vet: string;
const call = (method: string, url: string, token: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: bearer(token) });
const today = new Date().toISOString().slice(0, 10);

// Un JPEG minimal : l'en-tête FF D8 FF E0 suivi de remplissage (le serveur vérifie les premiers octets).
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]).toString('base64');

beforeAll(async () => {
  ctx = await setup();
  awa = (await login(ctx.app, '0712345678')).body.accessToken;
  seydou = (await login(ctx.app, '0723456789')).body.accessToken;
  vet = (await login(ctx.app, '0501020304')).body.accessToken;
  const reg = await ctx.app.inject({ method: 'POST', url: '/auth/register', payload: { role: 'particulier', name: 'Koffi Yao', phone: '0700000077', password: 'Demo1234!' } });
  expect(reg.statusCode).toBe(201);
  koffi = reg.json().accessToken; koffiId = reg.json().user.id;
});
afterAll(async () => { await ctx.close(); });

const listed = async (name: string, price = 200000) => {
  const a = (await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name })).json();
  expect((await call('POST', `/animals/${a.id}/listing`, awa, { price })).statusCode).toBe(201);
  return a;
};

describe('achat par un particulier', () => {
  it('le particulier s’inscrit, parcourt le marché et lit une fiche publique', async () => {
    const a = await listed('Noiraud');
    expect((await call('GET', '/market', koffi)).json().items.some((i: any) => i.id === a.id)).toBe(true);
    const sheet = (await call('GET', `/market/${a.id}`, koffi)).json();
    expect(sheet.price).toBe(200000);
    expect(sheet.rfid).toBeUndefined();
    expect((await call('GET', `/animals/${a.id}`, koffi)).statusCode).toBe(404); // pas la fiche privée
  });

  it('demande, doublon, propre animal, vétérinaire', async () => {
    const a = await listed('Demandée');
    expect((await call('POST', `/market/${a.id}/requests`, koffi, { message: 'Intéressé', offeredPrice: 180000 })).statusCode).toBe(201);
    expect((await call('POST', `/market/${a.id}/requests`, koffi, {})).json().code).toBe('request_exists');
    expect((await call('POST', `/market/${a.id}/requests`, awa, {})).json().code).toBe('own_animal');
    expect((await call('POST', `/market/${a.id}/requests`, vet, {})).statusCode).toBe(403);
  });

  it('parcours complet : le téléphone n’apparaît qu’après acceptation, puis la fiche change de compte', async () => {
    const a = await listed('Parcours');
    const r = (await call('POST', `/market/${a.id}/requests`, koffi, { offeredPrice: 190000 })).json();
    const received = (await call('GET', '/purchase-requests?q=koffi', awa)).json();
    expect(received.items[0].other.phone).toBeNull();
    expect((await call('GET', '/me/purchase-requests', koffi)).json().items.find((i: any) => i.id === r.id).other.phone).toBeNull();
    expect((await call('POST', `/purchase-requests/${r.id}/complete`, awa, {})).json().code).toBe('request_not_accepted');
    expect((await call('POST', `/purchase-requests/${r.id}/accept`, seydou, {})).statusCode).toBe(404);

    const acc = (await call('POST', `/purchase-requests/${r.id}/accept`, awa, { note: 'OK' })).json();
    expect(acc.status).toBe('acceptee');
    expect(acc.agreedPrice).toBe(190000);
    expect(acc.other.phone).toBe('0700000077');
    expect((await call('GET', '/me/purchase-requests', koffi)).json().items.find((i: any) => i.id === r.id).other.phone).toBe('0712345678');

    const done = (await call('POST', `/purchase-requests/${r.id}/complete`, awa, {})).json();
    expect(done.status).toBe('conclue');
    const mine = (await call('GET', `/animals/${a.id}`, koffi)).json();
    expect(mine.owner.id).toBe(koffiId);
    expect((await call('GET', `/animals/${a.id}`, awa)).statusCode).toBe(404);
    expect((await call('GET', `/animals/${a.id}/archive`, awa)).json().exit.type).toBe('vente');
    expect((await call('GET', `/market/${a.id}`, koffi)).statusCode).toBe(404);
  });

  it('une vente conclue refuse les autres demandes et les notifie', async () => {
    const a = await listed('Convoitée');
    const r1 = (await call('POST', `/market/${a.id}/requests`, koffi, {})).json();
    const r2 = (await call('POST', `/market/${a.id}/requests`, seydou, {})).json();
    await call('POST', `/purchase-requests/${r1.id}/accept`, awa, {});
    await call('POST', `/purchase-requests/${r1.id}/complete`, awa, {});
    const sent = (await call('GET', '/me/purchase-requests', seydou)).json().items.find((i: any) => i.id === r2.id);
    expect(sent.status).toBe('refusee');
    const n = (await call('GET', '/me/notifications?unread=true', seydou)).json();
    expect(n.items.some((x: any) => x.title.startsWith('Animal vendu'))).toBe(true);
  });

  it('l’acheteur peut annuler, pas le vendeur à sa place', async () => {
    const a = await listed('Annulée');
    const r = (await call('POST', `/market/${a.id}/requests`, koffi, {})).json();
    expect((await call('POST', `/purchase-requests/${r.id}/cancel`, awa, {})).statusCode).toBe(404);
    expect((await call('POST', `/purchase-requests/${r.id}/cancel`, koffi, {})).json().status).toBe('annulee');
    expect((await call('POST', `/purchase-requests/${r.id}/accept`, awa, {})).json().code).toBe('request_closed');
  });

  it('filtres de la liste (statut, date)', async () => {
    expect((await call('GET', '/me/purchase-requests?status=annulee', koffi)).json().total).toBeGreaterThanOrEqual(1);
    expect((await call('GET', '/me/purchase-requests?from=2099-01-01', koffi)).json().total).toBe(0);
    expect((await call('GET', '/me/purchase-requests?from=2026-02-01&to=2026-01-01', koffi)).statusCode).toBe(422);
  });
});

describe('notifications et rappels', () => {
  it('liste, lecture, tout lire, isolement entre comptes', async () => {
    const n = (await call('GET', '/me/notifications', awa)).json();
    expect(n.unread).toBeGreaterThan(0);
    expect((await call('POST', `/me/notifications/${n.items[0].id}/read`, awa)).statusCode).toBe(204);
    expect((await call('POST', `/me/notifications/${n.items[0].id}/read`, seydou)).statusCode).toBe(404);
    await call('POST', '/me/notifications/read-all', awa);
    expect((await call('GET', '/me/notifications?unread=true', awa)).json().total).toBe(0);
  });

  it('un rappel de vaccin proche crée une seule notification', async () => {
    const a = (await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name: 'Rappel' })).json();
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await call('POST', `/animals/${a.id}/health-events`, awa, { type: 'vaccin', label: 'Pasteurellose', doneOn: today, nextDueOn: soon });
    expect(await createReminderNotifications(ctx.db)).toBeGreaterThanOrEqual(1);
    expect(await createReminderNotifications(ctx.db)).toBe(0);
    const n = (await call('GET', '/me/notifications', awa)).json();
    expect(n.items.some((x: any) => x.title.includes('Pasteurellose'))).toBe(true);
  });
});

describe('photos envoyées', () => {
  it('envoi, lecture publique, contrôle du contenu, droits', async () => {
    const a = (await call('POST', '/animals', awa, { species: 'ovin', kind: 'individual', name: 'Photogénique' })).json();
    const up = await call('POST', `/animals/${a.id}/photos/upload`, awa, { contentType: 'image/jpeg', data: jpeg });
    expect(up.statusCode).toBe(201);
    const file = await ctx.app.inject({ method: 'GET', url: up.json().url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('image/jpeg');
    expect(file.rawPayload.length).toBe(304);
    expect((await call('GET', `/animals/${a.id}`, awa)).json().photos).toHaveLength(1);
    expect((await call('POST', `/animals/${a.id}/photos/upload`, awa, { contentType: 'image/png', data: jpeg })).statusCode).toBe(422);
    expect((await call('POST', `/animals/${a.id}/photos/upload`, seydou, { contentType: 'image/jpeg', data: jpeg })).statusCode).toBe(404);
  });
});
