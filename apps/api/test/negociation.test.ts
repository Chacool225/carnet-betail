import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let awa: string, seydou: string, resto: string, restoId: string;
const call = (method: string, url: string, token: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: bearer(token) });

beforeAll(async () => {
  ctx = await setup();
  awa = (await login(ctx.app, '0712345678')).body.accessToken;
  seydou = (await login(ctx.app, '0723456789')).body.accessToken;
  const reg = await ctx.app.inject({
    method: 'POST', url: '/auth/register',
    payload: { role: 'particulier', name: 'Resto Le Baobab', phone: '0700000088', password: 'Demo1234!',
      buyerProfile: { profession: 'Restaurateur', orgKind: 'restaurant', orgName: 'Le Baobab', contactName: 'Mme Koné', contactPhone: '07 11 22 33 44', locality: 'Cocody' } },
  });
  expect(reg.statusCode).toBe(201);
  resto = reg.json().accessToken; restoId = reg.json().user.id;
});
afterAll(async () => { await ctx.close(); });

const lot = async (name: string, qty: number, listing: Record<string, unknown>) => {
  const a = (await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name, qty })).json();
  expect((await call('POST', `/animals/${a.id}/listing`, awa, listing)).statusCode).toBe(201);
  return a;
};

describe('annonce à l’unité', () => {
  it('refuse un palier incohérent ou une quantité hors stock', async () => {
    const a = (await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name: 'Bande', qty: 150 })).json();
    expect((await call('POST', `/animals/${a.id}/listing`, awa, { price: 1500, bulkMinQty: 100 })).statusCode).toBe(422);
    expect((await call('POST', `/animals/${a.id}/listing`, awa, { price: 1500, bulkMinQty: 100, bulkPrice: 1500 })).statusCode).toBe(422);
    expect((await call('POST', `/animals/${a.id}/listing`, awa, { price: 1500, qty: 200 })).json().code).toBe('qty_exceeds_stock');
    const ind = (await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name: 'Seul' })).json();
    expect((await call('POST', `/animals/${ind.id}/listing`, awa, { price: 1000, qty: 2 })).statusCode).toBe(422);
  });

  it('publie 120 sur 150 avec un prix réduit dès 100, visible sur le marché et la fiche', async () => {
    const a = await lot('Poulets', 150, { price: 1500, qty: 120, bulkMinQty: 100, bulkPrice: 1200 });
    const own = (await call('GET', `/animals/${a.id}`, awa)).json();
    expect(own.listing).toMatchObject({ price: 1500, qty: 120, bulkMinQty: 100, bulkPrice: 1200 });
    const item = (await call('GET', '/market', resto)).json().items.find((i: any) => i.id === a.id);
    expect(item).toMatchObject({ price: 1500, listingQty: 120, bulkMinQty: 100, bulkPrice: 1200 });
    const sheet = (await call('GET', `/market/${a.id}`, resto)).json();
    expect(sheet).toMatchObject({ listingQty: 120, availableQty: 120, qty: 150 });
  });
});

describe('négociation, accord et vente partielle', () => {
  it('prix réduit automatique, propositions croisées, accord avec récapitulatif, lot scindé', async () => {
    const a = await lot('Bande B', 150, { price: 1500, qty: 120, bulkMinQty: 100, bulkPrice: 1200 });
    expect((await call('POST', `/market/${a.id}/requests`, resto, { qty: 121 })).json().code).toBe('qty_exceeds_available');
    const r = (await call('POST', `/market/${a.id}/requests`, resto, { qty: 100, message: 'Pour le restaurant' })).json();
    expect(r).toMatchObject({ qty: 100, unitPrice: 1200, total: 120000 });
    const small = (await call('POST', `/market/${a.id}/requests`, seydou, { qty: 20 })).json();
    expect(small).toMatchObject({ unitPrice: 1500, total: 30000 });

    // le vendeur voit qui achète, sans le numéro du responsable
    const rec = (await call('GET', '/purchase-requests?q=baobab', awa)).json().items.find((i: any) => i.id === r.id);
    expect(rec.buyerProfile).toMatchObject({ orgName: 'Le Baobab', profession: 'Restaurateur', locality: 'Cocody', contactPhone: null });

    // un tiers ne voit pas la conversation
    expect((await call('GET', `/purchase-requests/${r.id}/messages`, seydou)).statusCode).toBe(404);
    expect((await call('POST', `/purchase-requests/${r.id}/messages`, awa, { body: 'Je peux faire mieux ?' })).statusCode).toBe(201);

    const p1 = (await call('POST', `/purchase-requests/${r.id}/proposal`, awa, { qty: 100, unitPrice: 1300 })).json();
    expect(p1.agreed).toBe(false);
    expect((await call('POST', `/purchase-requests/${r.id}/proposal`, resto, { qty: 130, unitPrice: 1300 })).json().code).toBe('qty_exceeds_available');
    expect((await call('POST', `/purchase-requests/${r.id}/proposal`, resto, { qty: 100, unitPrice: 1250 })).json().agreed).toBe(false);
    const p3 = (await call('POST', `/purchase-requests/${r.id}/proposal`, awa, { qty: 100, unitPrice: 1250 })).json();
    expect(p3).toMatchObject({ agreed: true, status: 'acceptee', agreedQty: 100, agreedPrice: 1250, agreedTotal: 125000 });
    expect(p3.other.phone).toBe('0700000088');
    expect((await call('GET', '/purchase-requests?q=baobab', awa)).json().items.find((i: any) => i.id === r.id).buyerProfile.contactPhone).toBe('0711223344');

    const items = (await call('GET', `/purchase-requests/${r.id}/messages`, resto)).json().items;
    const recap = items[items.length - 1];
    expect(recap).toMatchObject({ kind: 'recap', senderId: null, qty: 100, unitPrice: 1250, total: 125000 });
    expect(recap.body).toContain('100 volailles');
    expect(recap.body).toContain('Bande B');
    expect((await call('POST', `/purchase-requests/${r.id}/proposal`, resto, { qty: 90, unitPrice: 1 })).json().code).toBe('request_closed');

    // 100 réservés sur 120 : il en reste 20
    expect((await call('GET', `/market/${a.id}`, seydou)).json().availableQty).toBe(20);
    expect((await call('POST', `/purchase-requests/${small.id}/proposal`, seydou, { qty: 30, unitPrice: 1500 })).json().code).toBe('qty_exceeds_available');
    expect((await call('POST', `/animals/${a.id}/listing`, awa, { price: 1500, qty: 90 })).json().code).toBe('qty_below_reserved');

    // vente partielle : un nouveau lot de 100 chez l'acheteur, 50 restent chez l'éleveur
    expect((await call('POST', `/purchase-requests/${r.id}/complete`, resto, {})).statusCode).toBe(404);
    const done = (await call('POST', `/purchase-requests/${r.id}/complete`, awa, {})).json();
    expect(done.status).toBe('conclue');
    expect(done.newAnimalId).toBeTruthy();
    const child = (await call('GET', `/animals/${done.newAnimalId}`, resto)).json();
    expect(child).toMatchObject({ qty: 100, kind: 'lot', species: 'volaille' });
    expect(child.owner.id).toBe(restoId);
    const left = (await call('GET', `/animals/${a.id}`, awa)).json();
    expect(left.qty).toBe(50);
    expect(left.listing.qty).toBe(20);
    expect((await call('GET', `/purchase-requests/${small.id}`, seydou)).json().status).toBe('en_attente');

    // le vendeur accepte tel quel la dernière demande : l'annonce est épuisée et retirée
    expect((await call('POST', `/purchase-requests/${small.id}/accept`, awa, {})).json()).toMatchObject({ status: 'acceptee', agreedQty: 20, agreedTotal: 30000 });
    expect((await call('POST', `/purchase-requests/${small.id}/complete`, awa, {})).json().status).toBe('conclue');
    const empty = (await call('GET', `/animals/${a.id}`, awa)).json();
    expect(empty.qty).toBe(30);
    expect(empty.listing).toBeNull();
  });

  it('un refus ferme la conversation', async () => {
    const a = (await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name: 'Tacheté' })).json();
    await call('POST', `/animals/${a.id}/listing`, awa, { price: 200000 });
    const r = (await call('POST', `/market/${a.id}/requests`, resto, { offeredPrice: 180000 })).json();
    expect(r).toMatchObject({ qty: 1, unitPrice: 180000 });
    await call('POST', `/purchase-requests/${r.id}/refuse`, awa, { note: 'Trop bas' });
    expect((await call('POST', `/purchase-requests/${r.id}/messages`, resto, { body: 'svp' })).json().code).toBe('request_closed');
  });
});

describe('profil acheteur', () => {
  it('se lit, se modifie, et reste réservé aux particuliers', async () => {
    expect((await call('GET', '/me/buyer-profile', resto)).json().profile).toMatchObject({ orgName: 'Le Baobab', contactPhone: '0711223344' });
    const put = await call('PUT', '/me/buyer-profile', resto, { profession: 'Chef', orgKind: 'hotel', orgName: 'Hôtel Ivoire', locality: 'Plateau' });
    expect(put.statusCode).toBe(200);
    expect(put.json().profile).toMatchObject({ orgKind: 'hotel', orgName: 'Hôtel Ivoire', contactPhone: null });
    expect((await call('PUT', '/me/buyer-profile', resto, { orgKind: 'hotel' })).statusCode).toBe(422);
    expect((await call('PUT', '/me/buyer-profile', awa, { profession: 'x' })).statusCode).toBe(403);
  });

  it('l’inscription refuse un profil acheteur pour un éleveur', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/auth/register', payload: { role: 'eleveur', name: 'Moussa', phone: '0700000066', password: 'Demo1234!', buyerProfile: { profession: 'x' } } });
    expect(r.statusCode).toBe(422);
  });
});
