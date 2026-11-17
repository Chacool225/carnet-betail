import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let awa: string, seydou: string, vet: string;
const call = (method: string, url: string, token: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: bearer(token) });
const sync = async (token: string, ops: unknown[]) => call('POST', '/sync', token, { ops });
const day = (o = 0) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await setup();
  awa = (await login(ctx.app, '0712345678')).body.accessToken;
  seydou = (await login(ctx.app, '0723456789')).body.accessToken;
  vet = (await login(ctx.app, '0501020304')).body.accessToken;
});
afterAll(async () => { await ctx.close(); });

describe('envoi groupé hors-ligne (RG9)', () => {
  it('exige une connexion et un envoi valide', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/sync', payload: { ops: [] } })).statusCode).toBe(401);
    expect((await sync(awa, [])).statusCode).toBe(422);
    expect((await sync(awa, [{ clientId: 'pas-un-uuid', type: 'animal.create', payload: {} }])).statusCode).toBe(422);
    expect((await sync(awa, [{ clientId: randomUUID(), type: 'inconnu', payload: {} }])).statusCode).toBe(422);
    const tooMany = Array.from({ length: 101 }, () => ({ clientId: randomUUID(), type: 'animal.create', payload: {} }));
    expect((await sync(awa, tooMany)).statusCode).toBe(422);
  });
  it('crée une fiche, puis y rattache un acte et un signalement dans le même envoi (ref:)', async () => {
    const a = randomUUID(), h = randomUUID(), c = randomUUID();
    const r = await sync(awa, [
      { clientId: a, type: 'animal.create', payload: { species: 'bovin', kind: 'individual', name: 'Née hors-ligne' } },
      { clientId: h, type: 'health.create', payload: { animalId: `ref:${a}`, type: 'vaccin', label: 'Charbon', doneOn: day(-1) } },
      { clientId: c, type: 'case.create', payload: { animalId: `ref:${a}`, diseases: ['Toux'], affectedCount: 1, severity: 'legere' } },
    ]);
    expect(r.statusCode).toBe(200);
    const res = r.json().results;
    expect(res.map((x: any) => x.status)).toEqual(['ok', 'ok', 'ok']);
    expect(res[0].result.code).toMatch(/^CI-BOV-/);
    const animal = (await call('GET', `/animals/${res[0].result.id}`, awa)).json();
    expect(animal.name).toBe('Née hors-ligne');
    expect((await call('GET', `/animals/${animal.id}/health-events`, awa)).json().items.length).toBe(1);
    expect((await call('GET', `/animals/${animal.id}/cases`, awa)).json().items.length).toBe(1);
  });
  it('rejouer le même envoi ne crée aucun doublon et renvoie les résultats d’origine', async () => {
    const id = randomUUID();
    const ops = [{ clientId: id, type: 'animal.create', payload: { species: 'volaille', kind: 'lot', name: 'Bande sync', qty: 30 } }];
    const first = (await sync(awa, ops)).json().results[0];
    const again = (await sync(awa, ops)).json().results[0];
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM animals WHERE name = 'Bande sync'"))[0]!.n).toBe(1);
  });
  it('deux envois simultanés de la même opération ne l’exécutent qu’une fois', async () => {
    const id = randomUUID();
    const ops = [{ clientId: id, type: 'animal.create', payload: { species: 'bovin', kind: 'individual', name: 'Course sync' } }];
    const rs = await Promise.all([sync(awa, ops), sync(awa, ops), sync(awa, ops)]);
    expect(rs.every((r) => r.json().results[0].status === 'ok')).toBe(true);
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM animals WHERE name = 'Course sync'"))[0]!.n).toBe(1);
  });
  it('une erreur n’arrête pas les opérations suivantes et n’est pas mémorisée', async () => {
    const bad = randomUUID(), good = randomUUID();
    const r = (await sync(awa, [
      { clientId: bad, type: 'animal.create', payload: { species: 'volaille', kind: 'individual', name: 'Invalide' } },
      { clientId: good, type: 'animal.create', payload: { species: 'bovin', kind: 'individual', name: 'Valide après erreur' } },
    ])).json().results;
    expect(r[0]).toMatchObject({ status: 'error', error: { code: 'validation_error', status: 422 } });
    expect(r[1].status).toBe('ok');
    expect((await ctx.db.query('SELECT 1 FROM client_ops WHERE client_id = $1', [bad])).length).toBe(0);
    // le client corrige et renvoie avec le même identifiant
    const fixed = (await sync(awa, [{ clientId: bad, type: 'animal.create', payload: { species: 'volaille', kind: 'lot', name: 'Corrigé', qty: 5 } }])).json().results[0];
    expect(fixed.status).toBe('ok');
  });
  it('les règles métier s’appliquent comme en direct', async () => {
    const lot = (await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name: 'Stock sync', qty: 10 })).json();
    const r = (await sync(awa, [
      { clientId: randomUUID(), type: 'mortality.declare', payload: { animalId: lot.id, qty: 11 } },
      { clientId: randomUUID(), type: 'mortality.declare', payload: { animalId: lot.id, qty: 4 } },
      { clientId: randomUUID(), type: 'sale', payload: { animalId: lot.id, qty: 3, counterpart: 'Marché' } },
    ])).json().results;
    expect(r[0].error.code).toBe('qty_exceeds_stock');
    expect(r[1].status).toBe('ok');
    expect(r[2].status).toBe('ok');
    expect((await call('GET', `/animals/${lot.id}`, awa)).json().qty).toBe(3);
  });
  it('les droits sont vérifiés : un autre éleveur reçoit 404, un vétérinaire ne crée pas de fiche', async () => {
    const lot = (await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name: 'Pas à lui', qty: 10 })).json();
    const r = (await sync(seydou, [{ clientId: randomUUID(), type: 'mortality.declare', payload: { animalId: lot.id, qty: 1 } }])).json().results[0];
    expect(r.error.status).toBe(404);
    const v = (await sync(vet, [{ clientId: randomUUID(), type: 'animal.create', payload: { species: 'bovin', kind: 'individual', name: 'X' } }])).json().results[0];
    expect(v.error.status).toBe(403);
  });
  it('un identifiant d’opération ne peut pas être repris par un autre utilisateur ni pour un autre type', async () => {
    const id = randomUUID();
    await sync(awa, [{ clientId: id, type: 'animal.create', payload: { species: 'bovin', kind: 'individual', name: 'Propriété d’Awa' } }]);
    const other = (await sync(seydou, [{ clientId: id, type: 'animal.create', payload: { species: 'bovin', kind: 'individual', name: 'Volée' } }])).json().results[0];
    expect(other.error.code).toBe('client_id_conflict');
    const diff = (await sync(awa, [{ clientId: id, type: 'sale', payload: { animalId: randomUUID() } }])).json().results[0];
    expect(diff.error.code).toBe('client_id_conflict');
  });
  it('référence introuvable ou venant d’un autre utilisateur', async () => {
    const r = (await sync(awa, [{ clientId: randomUUID(), type: 'health.create', payload: { animalId: `ref:${randomUUID()}`, type: 'vaccin', label: 'x', doneOn: day(0) } }])).json().results[0];
    expect(r.error.code).toBe('ref_not_found');
    const missing = (await sync(awa, [{ clientId: randomUUID(), type: 'health.create', payload: { type: 'vaccin', label: 'x', doneOn: day(0) } }])).json().results[0];
    expect(missing.error.status).toBe(422);
  });
  it('conflit de version : refuse une modification basée sur une fiche périmée et renvoie la version du serveur', async () => {
    const cow = (await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name: 'Version 1' })).json();
    await call('PATCH', `/animals/${cow.id}`, awa, { name: 'Version serveur' });
    const stale = (await sync(awa, [{ clientId: randomUUID(), type: 'animal.update', payload: { animalId: cow.id, baseUpdatedAt: cow.updatedAt, name: 'Version téléphone' } }])).json().results[0];
    expect(stale.error.code).toBe('conflict_stale');
    expect(stale.error.details.server.name).toBe('Version serveur');
    expect((await call('GET', `/animals/${cow.id}`, awa)).json().name).toBe('Version serveur');
    const fresh = (await call('GET', `/animals/${cow.id}`, awa)).json();
    const ok = (await sync(awa, [{ clientId: randomUUID(), type: 'animal.update', payload: { animalId: cow.id, baseUpdatedAt: fresh.updatedAt, name: 'Version téléphone' } }])).json().results[0];
    expect(ok.status).toBe('ok');
    expect((await call('GET', `/animals/${cow.id}`, awa)).json().name).toBe('Version téléphone');
  });
  it('vol déclaré hors-ligne', async () => {
    const cow = (await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name: 'Volée sync' })).json();
    const r = (await sync(awa, [{ clientId: randomUUID(), type: 'theft.declare', payload: { animalId: cow.id, note: 'vue hier' } }])).json().results[0];
    expect(r.result.status).toBe('vole');
  });
});

describe('récupération des changements (pull)', () => {
  it('renvoie tout au premier appel, puis seulement les changements', async () => {
    const first = (await call('GET', '/sync/pull', awa)).json();
    expect(first.animals.length).toBeGreaterThan(0);
    expect(first.animals.every((a: any) => a.owner.name === 'Awa Koné')).toBe(true);
    expect(first.hasMore).toBe(false);
    const since = first.serverTime;
    const none = (await call('GET', `/sync/pull?since=${encodeURIComponent(since)}`, awa)).json();
    expect(none.animals).toEqual([]);
    expect(none.healthEvents).toEqual([]);
    const cow = (await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name: 'Nouvelle' })).json();
    await call('POST', `/animals/${cow.id}/health-events`, awa, { type: 'soin', label: 'Soin pull', doneOn: day(0) });
    const next = (await call('GET', `/sync/pull?since=${encodeURIComponent(since)}`, awa)).json();
    expect(next.animals.map((a: any) => a.name)).toContain('Nouvelle');
    expect(next.healthEvents.map((e: any) => e.label)).toEqual(['Soin pull']);
  });
  it('respecte la visibilité et valide since', async () => {
    const s = (await call('GET', '/sync/pull', seydou)).json();
    expect(s.animals.map((a: any) => a.code)).toEqual(['CI-BOV-00431']);
    expect((await call('GET', '/sync/pull?since=hier', awa)).statusCode).toBe(422);
  });
});
