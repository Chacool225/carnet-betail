import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestCtx } from './helpers.js';
import { migrate } from '../src/db/migrate.js';

let ctx: TestCtx;
const U = '00000000-0000-4000-8000-0000000000a1';
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.close(); });

const animal = (extra: string, vals: unknown[]) =>
  ctx.db.query(`INSERT INTO animals (${extra}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(',')})`, vals);

describe('migrations', () => {
  it('sont rejouables sans effet', async () => {
    expect(await migrate(ctx.db)).toEqual([]);
    const n = (await ctx.db.query('SELECT count(*)::int AS n FROM schema_migrations'))[0]!.n;
    expect(n).toBe(2);
  });
});

describe('historique en ajout seul (RG2)', () => {
  it('audit_log refuse UPDATE et DELETE', async () => {
    await ctx.db.query("INSERT INTO audit_log (actor_id, action) VALUES ($1, 'test')", [U]);
    await expect(ctx.db.query("UPDATE audit_log SET action = 'x'")).rejects.toThrow();
    await expect(ctx.db.query('DELETE FROM audit_log')).rejects.toThrow();
  });
  it.each(['health_events', 'flows', 'transfers'])('%s est protégée par un déclencheur', async (t) => {
    const trg = await ctx.db.query(
      `SELECT 1 FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal`, [t]);
    expect(trg.length).toBeGreaterThan(0);
  });
});

describe('contraintes de données', () => {
  it('numéro de téléphone : 10 chiffres', async () => {
    await expect(ctx.db.query("INSERT INTO users (role,name,phone,password_hash) VALUES ('eleveur','X','12345','h')")).rejects.toThrow();
  });
  it('e-mail en minuscules', async () => {
    await expect(ctx.db.query("INSERT INTO users (role,name,phone,email,password_hash) VALUES ('eleveur','X','0700000099','A@B.CI','h')")).rejects.toThrow();
  });
  it('le téléphone est unique', async () => {
    await expect(ctx.db.query("INSERT INTO users (role,name,phone,password_hash) VALUES ('eleveur','X','0712345678','h')")).rejects.toThrow();
  });
  it('supprimer un compte supprime ses sessions', async () => {
    const r = await ctx.db.query("INSERT INTO users (role,name,phone,password_hash) VALUES ('eleveur','Tmp','0700000098','h') RETURNING id");
    const id = r[0]!.id;
    await ctx.db.query("INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at) VALUES ($1,'h1',gen_random_uuid(), now() + interval '1 day')", [id]);
    await ctx.db.query('DELETE FROM users WHERE id = $1', [id]);
    expect((await ctx.db.query("SELECT 1 FROM refresh_tokens WHERE token_hash = 'h1'")).length).toBe(0);
  });
});

const Z = '00000000-0000-4000-8000-000000000003';
const ins = (code: string, kind: string, qty: number | null, qi: number | null, rfid: string | null = null) =>
  ctx.db.query(
    `INSERT INTO animals (public_code, kind, species, name, owner_id, zone_id, qty, qty_initial, rfid)
     VALUES ($1,$2,'bovin','Test',$3,$4,$5,$6,$7)`,
    [code, kind, U, Z, qty, qi, rfid],
  );

describe('animaux : règles de gestion en base', () => {
  it('un lot a un effectif, un animal seul n’en a pas', async () => {
    await expect(ins('T-1', 'lot', null, null)).rejects.toThrow();
    await expect(ins('T-2', 'individual', 5, 5)).rejects.toThrow();
    await ins('T-3', 'individual', null, null);
    await ins('T-4', 'lot', 10, 10);
  });
  it('RG5 : l’effectif ne peut pas être négatif', async () => {
    await expect(ins('T-5', 'lot', -1, 10)).rejects.toThrow();
  });
  it('RG8 : une boucle RFID, une seule fiche', async () => {
    await ins('T-6', 'individual', null, null, '0123456789AB');
    await expect(ins('T-7', 'individual', null, null, '0123456789AB')).rejects.toThrow();
  });
  it('RG2 : un acte de santé ne se modifie ni ne se supprime', async () => {
    const a = (await ctx.db.query("SELECT id FROM animals WHERE public_code = 'T-3'"))[0]!.id;
    await ctx.db.query(
      "INSERT INTO health_events (animal_id, type, label, done_on, recorded_by) VALUES ($1,'vaccin','Charbon','2026-11-01',$2)",
      [a, U],
    );
    await expect(ctx.db.query("UPDATE health_events SET label = 'autre'")).rejects.toThrow();
    await expect(ctx.db.query('DELETE FROM health_events')).rejects.toThrow();
    await expect(ctx.db.query("UPDATE health_events SET label = 'autre' WHERE id = '00000000-0000-4000-8000-0000000002a1'")).rejects.toThrow();
  });
  it('les dates restent des chaînes AAAA-MM-JJ', async () => {
    const r = await ctx.db.query("SELECT done_on FROM health_events WHERE animal_id = (SELECT id FROM animals WHERE public_code = 'T-3')");
    expect(typeof r[0]!.done_on === 'string' ? r[0]!.done_on : r[0]!.done_on.toISOString().slice(0, 10)).toBe('2026-11-01');
  });
});
