import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, login, bearer, type TestCtx } from './helpers.js';
import { seedComplet, U } from '../src/scripts/seed-complet.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.close(); });

describe('seed complet', () => {
  it('se charge, respecte les règles de cohérence (verify) et se rejoue sans doublon', async () => {
    const first = await ctx.db.tx((q) => seedComplet(q));
    expect(first.skipped).toBe(false);
    expect(first.counts.users).toBe(14);
    const again = await ctx.db.tx((q) => seedComplet(q));
    expect(again.skipped).toBe(true);
  });

  it("couvre tous les types d'événements et toutes les actions du journal", async () => {
    const flows = (await ctx.db.query<{ type: string }>('SELECT DISTINCT type FROM flows')).map((r) => r.type);
    for (const t of ['entree', 'identification', 'pesee', 'vente', 'mortalite', 'abattage', 'vol']) expect(flows).toContain(t);
    const health = (await ctx.db.query<{ type: string }>('SELECT DISTINCT type FROM health_events')).map((r) => r.type);
    for (const t of ['vaccin', 'soin', 'controle']) expect(health).toContain(t);
    const msgs = (await ctx.db.query<{ kind: string }>('SELECT DISTINCT kind FROM purchase_messages')).map((r) => r.kind);
    for (const k of ['text', 'proposal', 'recap', 'system']) expect(msgs).toContain(k);
    const status = (await ctx.db.query<{ status: string }>('SELECT DISTINCT status FROM purchase_requests')).map((r) => r.status);
    for (const s of ['en_attente', 'acceptee', 'refusee', 'annulee', 'conclue']) expect(status).toContain(s);
  });

  it("se connecte avec un compte du jeu et voit son historique", async () => {
    const { res, body } = await login(ctx.app, '0734567890');
    expect(res.statusCode).toBe(200);
    const h = await ctx.app.inject({ method: 'GET', url: '/me/history?limit=50', headers: bearer(body.accessToken) });
    expect(h.statusCode).toBe(200);
    expect(h.json().items.length).toBeGreaterThan(5);
    expect(U.moussa).toBeTruthy();
  });
});
