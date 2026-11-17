import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';
import { cleanup } from '../src/jobs/cleanup.js';
import { csvCell, toCsv } from '../src/lib/csv.js';

let ctx: TestCtx;
let awa: string, vet: string, agent: string, autorite: string;
const call = (method: string, url: string, token: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: bearer(token) });

beforeAll(async () => {
  ctx = await setup();
  awa = (await login(ctx.app, '0712345678')).body.accessToken;
  vet = (await login(ctx.app, '0501020304')).body.accessToken;
  agent = (await login(ctx.app, '0102030405')).body.accessToken;
  autorite = (await login(ctx.app, '0505050505')).body.accessToken;
  const lot = (await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name: 'Bande stats', qty: 100 })).json();
  await call('POST', `/animals/${lot.id}/mortality`, awa, { qty: 20, cause: 'Chaleur' });
  await call('POST', `/animals/${lot.id}/cases`, awa, { diseases: ['Newcastle'], affectedCount: 30, severity: 'grave' });
  await call('POST', '/animals', awa, { species: 'bovin', kind: 'individual', name: '=HYPERLINK("http://x")' });
});
afterAll(async () => { await ctx.close(); });

describe('indicateurs', () => {
  it('réservés à l’agent et à l’autorité', async () => {
    expect((await call('GET', '/stats/overview', awa)).statusCode).toBe(403);
    expect((await call('GET', '/stats/zones', vet)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: '/stats/overview' })).statusCode).toBe(401);
  });
  it('vue nationale de l’autorité', async () => {
    const o = (await call('GET', '/stats/overview', autorite)).json();
    expect(o.scope).toBe('national');
    expect(o.deaths).toBe(20);
    expect(o.openCases).toBe(1);
    expect(o.topDiseases[0]).toMatchObject({ disease: 'newcastle', cases: 1, notifiable: true });
    const vol = o.activeBySpecies.find((s: any) => s.species === 'volaille');
    expect(vol.heads).toBe(150 + 80); // lot de démonstration (150) + bande de test (100 - 20)
    expect(o.unhandledAlerts.sanitaire).toBeGreaterThanOrEqual(1);
    expect(o.vets).toEqual({ total: 1, verified: 1 });
  });
  it('l’agent ne voit que sa zone', async () => {
    const o = (await call('GET', '/stats/overview', agent)).json();
    expect(o.scope).toBe('zone');
    expect(o.deaths).toBe(0); // les morts du test sont à Korhogo, l'agent est à Ferkessédougou
    const z = (await call('GET', '/stats/zones', agent)).json().items;
    expect(z.length).toBe(1);
    expect(z[0].zone.name).toBe('Ferkessédougou');
  });
  it('classement par zone avec taux de mortalité', async () => {
    const z = (await call('GET', '/stats/zones', autorite)).json();
    expect(z.items.length).toBeGreaterThanOrEqual(8);
    const k = z.items.find((i: any) => i.zone.name === 'Korhogo');
    expect(k.deaths).toBe(20);
    expect(k.openCases).toBe(1);
    expect(k.mortalityRate).toBeCloseTo(20 / (k.heads + 20), 4);
    const empty = z.items.find((i: any) => i.zone.name === 'Man');
    expect(empty).toMatchObject({ animals: 0, heads: 0, deaths: 0, mortalityRate: 0 });
  });
});

describe('exports CSV', () => {
  it('animaux : BOM, séparateur « ; », accents et filtrage par rôle', async () => {
    const r = await call('GET', '/export/animals.csv', awa);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('animaux.csv');
    expect(r.body.startsWith('﻿code;espece;')).toBe(true);
    expect(r.body).toContain('Awa Koné');
    expect(r.body).not.toContain('Seydou Traoré');
    const all = (await call('GET', '/export/animals.csv', autorite)).body;
    expect(all).toContain('Seydou Traoré');
    expect(all).toContain('CI-BOV-00431');
  });
  it('protège contre l’injection de formules', async () => {
    const body = (await call('GET', '/export/animals.csv', awa)).body;
    expect(body).toContain(`'=HYPERLINK`);
    expect(body).not.toMatch(/;=HYPERLINK/);
  });
  it('signalements : maladies à déclaration obligatoire marquées', async () => {
    const body = (await call('GET', '/export/cases.csv', autorite)).body;
    expect(body).toContain('Newcastle');
    expect(body.split('\r\n')[1]).toContain(';oui;');
  });
  it('un vétérinaire n’exporte que ses accès', async () => {
    const body = (await call('GET', '/export/animals.csv', vet)).body.trim().split('\r\n');
    expect(body.length).toBe(2); // en-tête + le bovin dont il a l'accès
    expect(body[1]).toContain('CI-BOV-00431');
  });
});

describe('utilitaires CSV', () => {
  it('échappe guillemets, points-virgules et retours à la ligne', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });
  it('neutralise les formules, garde les nombres et les vides', () => {
    for (const f of ['=1+1', '+33', '-2', '@SUM(A1)', '\tx']) expect(csvCell(f).startsWith(`'`)).toBe(true);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(true)).toBe('oui');
  });
  it('toCsv', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a;b\r\n1;x\r\n');
  });
});

describe('ménage des tables techniques', () => {
  it('supprime les clés, jetons et opérations périmés, garde le reste', async () => {
    const uid = (await ctx.db.query("SELECT id FROM users WHERE phone = '0712345678'"))[0]!.id;
    await ctx.db.query(
      `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash, status, created_at) VALUES
        ($1,'old-done-0001','POST','/x','h',201, now() - interval '3 days'),
        ($1,'new-done-0001','POST','/x','h',201, now()),
        ($1,'old-stuck-0001','POST','/x','h',NULL, now() - interval '1 hour'),
        ($1,'new-stuck-0001','POST','/x','h',NULL, now())`, [uid]);
    await ctx.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, revoked_at) VALUES
        ($1,'t-expired',gen_random_uuid(), now() - interval '8 days', NULL),
        ($1,'t-revoked-old',gen_random_uuid(), now() + interval '1 day', now() - interval '31 days'),
        ($1,'t-valid',gen_random_uuid(), now() + interval '1 day', NULL),
        ($1,'t-revoked-recent',gen_random_uuid(), now() + interval '1 day', now() - interval '1 day')`, [uid]);
    await ctx.db.query(
      `INSERT INTO client_ops (client_id, user_id, type, status, created_at) VALUES
        (gen_random_uuid(), $1, 'animal.create', 'ok', now() - interval '100 days'),
        (gen_random_uuid(), $1, 'animal.create', 'ok', now())`, [uid]);
    const before = (await ctx.db.query('SELECT count(*)::int AS n FROM client_ops'))[0]!.n;
    const r = await cleanup(ctx.db);
    expect(r.idempotencyKeys).toBe(2);
    expect(r.refreshTokens).toBe(2);
    expect(r.clientOps).toBe(1);
    const keys = (await ctx.db.query("SELECT key FROM idempotency_keys WHERE key LIKE '%-0001' ORDER BY key")).map((k) => k.key);
    expect(keys).toEqual(['new-done-0001', 'new-stuck-0001']);
    const toks = (await ctx.db.query("SELECT token_hash FROM refresh_tokens WHERE token_hash LIKE 't-%' ORDER BY token_hash")).map((k) => k.token_hash);
    expect(toks).toEqual(['t-revoked-recent', 't-valid']);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM client_ops'))[0]!.n).toBe(before - 1);
    // l'historique métier n'est jamais touché
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM audit_log'))[0]!.n).toBeGreaterThan(0);
  });
});
