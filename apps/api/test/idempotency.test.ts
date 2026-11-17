import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let token: string;
beforeAll(async () => {
  ctx = await setup();
  token = (await login(ctx.app, '0712345678')).body.accessToken;
});
afterAll(async () => { await ctx.close(); });

const patch = (payload: unknown, key?: string) =>
  ctx.app.inject({ method: 'PATCH', url: '/me', payload: payload as any, headers: { ...bearer(token), ...(key ? { 'idempotency-key': key } : {}) } });

describe('Idempotency-Key', () => {
  it('rejoue la réponse sans refaire l’écriture', async () => {
    const key = 'key-aaaaaaaa-0001';
    const a = await patch({ name: 'Awa Un' }, key);
    expect(a.statusCode).toBe(200);
    // on modifie la base en douce : un vrai rejeu ne doit pas la réécrire
    await ctx.db.query("UPDATE users SET name = 'Changé ailleurs' WHERE phone = '0712345678'");
    const b = await patch({ name: 'Awa Un' }, key);
    expect(b.statusCode).toBe(200);
    expect(b.headers['idempotency-replayed']).toBe('true');
    expect(b.json()).toEqual(a.json());
    expect((await ctx.db.query("SELECT name FROM users WHERE phone = '0712345678'"))[0]!.name).toBe('Changé ailleurs');
  });
  it('refuse la même clé pour une requête différente', async () => {
    const key = 'key-aaaaaaaa-0002';
    await patch({ name: 'Awa Deux' }, key);
    const r = await patch({ name: 'Autre nom' }, key);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('idempotency_key_reuse');
  });
  it('ne mémorise pas les échecs : la clé reste réutilisable', async () => {
    const key = 'key-aaaaaaaa-0003';
    expect((await patch({ phone: '0501020304' }, key)).statusCode).toBe(409);
    expect((await ctx.db.query('SELECT 1 FROM idempotency_keys WHERE key = $1', [key])).length).toBe(0);
    expect((await patch({ name: 'Awa Trois' }, key)).statusCode).toBe(200);
  });
  it('signale une requête identique encore en cours', async () => {
    const key = 'key-aaaaaaaa-0004';
    const body = { name: 'Awa Quatre' };
    const hash = (await import('node:crypto')).createHash('sha256').update(`PATCH\n/me\n${JSON.stringify(body)}`).digest('hex');
    const uid = (await ctx.db.query("SELECT id FROM users WHERE phone = '0712345678'"))[0]!.id;
    await ctx.db.query("INSERT INTO idempotency_keys (user_id, key, method, path, request_hash) VALUES ($1,$2,'PATCH','/me',$3)", [uid, key, hash]);
    const r = await patch(body, key);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('request_in_progress');
  });
  it('rejette une clé trop courte', async () => {
    expect((await patch({ name: 'Awa Cinq' }, 'court')).statusCode).toBe(422);
  });
  it('sans clé, rien n’est mémorisé', async () => {
    const before = (await ctx.db.query('SELECT count(*)::int AS n FROM idempotency_keys'))[0]!.n;
    await patch({ name: 'Awa Six' });
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM idempotency_keys'))[0]!.n).toBe(before);
  });
  it('les clés sont propres à chaque utilisateur', async () => {
    const other = (await login(ctx.app, '0501020304')).body.accessToken;
    const key = 'key-aaaaaaaa-0007';
    await patch({ name: 'Awa Sept' }, key);
    const r = await ctx.app.inject({ method: 'PATCH', url: '/me', payload: { name: 'Dr Sept' }, headers: { ...bearer(other), 'idempotency-key': key } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['idempotency-replayed']).toBeUndefined();
  });
});
