import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';
import { setSmsSender } from '../src/lib/sms.js';

let ctx: TestCtx;
let awa: string, autorite: string;
const sms: { to: string; text: string }[] = [];
const call = (method: string, url: string, token: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: bearer(token) });
const post = (url: string, payload: unknown) => ctx.app.inject({ method: 'POST', url, payload: payload as any });
const lastCode = () => /\b(\d{6})\b/.exec(sms[sms.length - 1]!.text)![1]!;

beforeAll(async () => {
  ctx = await setup();
  setSmsSender(async (to, text) => { sms.push({ to, text }); });
  awa = (await login(ctx.app, '0712345678')).body.accessToken;
  autorite = (await login(ctx.app, '0505050505')).body.accessToken;
});
afterAll(async () => { setSmsSender(null); await ctx.close(); });

describe('mot de passe oublié', () => {
  it('même réponse pour un numéro inconnu, rien d’envoyé', async () => {
    expect((await post('/auth/forgot-password', { phone: '0799999999' })).statusCode).toBe(202);
    expect(sms).toHaveLength(0);
  });

  it('code par SMS, mauvais code refusé, bon code accepté une seule fois, anciennes sessions fermées', async () => {
    const old = await login(ctx.app, '0712345678');
    expect((await post('/auth/forgot-password', { phone: '0712345678' })).statusCode).toBe(202);
    expect(sms).toHaveLength(1);
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await post('/auth/reset-password', { phone: '0712345678', code: wrong, newPassword: 'NouveauMdp1!' })).statusCode).toBe(422);
    expect((await post('/auth/reset-password', { phone: '0712345678', code, newPassword: 'NouveauMdp1!' })).statusCode).toBe(204);
    expect((await post('/auth/reset-password', { phone: '0712345678', code, newPassword: 'Autre12345!' })).statusCode).toBe(422);
    expect((await login(ctx.app, '0712345678', 'NouveauMdp1!')).res.statusCode).toBe(200);
    expect((await login(ctx.app, '0712345678')).res.statusCode).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: old.body.refreshToken })).statusCode).toBe(401);
  });

  it('cinq mauvais essais bloquent le code', async () => {
    await ctx.db.query("UPDATE password_resets SET created_at = now() - interval '2 minutes'");
    await post('/auth/forgot-password', { phone: '0712345678' });
    const code = lastCode();
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await post('/auth/reset-password', { phone: '0712345678', code: wrong, newPassword: 'Zzzzzzzz1!' });
    expect((await post('/auth/reset-password', { phone: '0712345678', code, newPassword: 'Zzzzzzzz1!' })).statusCode).toBe(422);
  });
});

describe('carte sanitaire et audit', () => {
  it('carte et courbe : autorité oui, éleveur non', async () => {
    const m = await call('GET', '/stats/health-map?days=30', autorite);
    expect(m.statusCode).toBe(200);
    expect(Array.isArray(m.json().items)).toBe(true);
    const t = (await call('GET', '/stats/cases-timeline?days=60', autorite)).json();
    expect(t.points.length).toBeGreaterThanOrEqual(8);
    expect((await call('GET', '/stats/health-map', awa)).statusCode).toBe(403);
  });

  it('journal d’audit : lecture seule réservée à l’autorité, avec filtres', async () => {
    const a = (await call('GET', '/audit?limit=10', autorite)).json();
    expect(a.total).toBeGreaterThan(0);
    expect(a.items[0].label).toBeTruthy();
    expect((await call('GET', '/audit?category=compte&role=eleveur', autorite)).json().items.every((i: any) => i.category === 'compte')).toBe(true);
    expect((await call('GET', '/audit?from=2099-01-01', autorite)).json().total).toBe(0);
    expect((await call('GET', '/audit', awa)).statusCode).toBe(403);
    expect((await call('GET', '/audit?from=2026-02-01&to=2026-01-01', autorite)).statusCode).toBe(422);
  });
});
