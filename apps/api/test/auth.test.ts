import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.close(); });

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'POST', url, payload: payload as any, headers });

describe('santé et zones', () => {
  it('GET /health', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ok');
    expect(r.headers['x-request-id']).toBeTruthy();
  });
  it('GET /zones est public', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/zones' });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.length).toBeGreaterThanOrEqual(8);
  });
  it('route inconnue → enveloppe d’erreur', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/nimporte' });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe('not_found');
  });
});

describe('inscription', () => {
  it('crée un éleveur et renvoie des jetons', async () => {
    const r = await post('/auth/register', { role: 'eleveur', name: 'Moussa Diallo', phone: '07 99 88 77 66', password: 'motdepasse1', pin: '2468' });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.user.phone).toBe('0799887766');
    expect(b.user.role).toBe('eleveur');
    expect(b.accessToken).toBeTruthy();
    expect(b.refreshToken).toBeTruthy();
    expect(JSON.stringify(b)).not.toMatch(/password_hash|pin_hash|scrypt/);
  });
  it('refuse un téléphone déjà utilisé (même écrit autrement)', async () => {
    const r = await post('/auth/register', { role: 'eleveur', name: 'Autre', phone: '+2250799887766', password: 'motdepasse1' });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('phone_taken');
  });
  it('refuse un e-mail déjà utilisé', async () => {
    const r = await post('/auth/register', { role: 'eleveur', name: 'Autre', phone: '0700000001', email: 'AWA@demo.ci', password: 'motdepasse1' });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('email_taken');
  });
  it('valide les champs (422)', async () => {
    const r = await post('/auth/register', { role: 'eleveur', name: 'A', phone: '123', password: 'court' });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('validation_error');
    expect(r.json().details.length).toBeGreaterThan(1);
  });
  it('un vétérinaire doit fournir son numéro d’ordre', async () => {
    const r = await post('/auth/register', { role: 'vet', name: 'Dr Test', phone: '0700000002', password: 'motdepasse1' });
    expect(r.statusCode).toBe(422);
  });
  it('un vétérinaire s’inscrit non vérifié', async () => {
    const r = await post('/auth/register', { role: 'vet', name: 'Dr Test', phone: '0700000003', password: 'motdepasse1', orderNumber: 'ONV-CI-9999' });
    expect(r.statusCode).toBe(201);
    expect(r.json().user.vet).toEqual({ orderNumber: 'ONV-CI-9999', clinic: null, verified: false });
  });
  it('numéro d’ordre unique', async () => {
    const r = await post('/auth/register', { role: 'vet', name: 'Dr Bis', phone: '0700000004', password: 'motdepasse1', orderNumber: 'ONV-CI-9999' });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('order_number_taken');
  });
  it('un rôle autorité ne peut pas s’auto-inscrire', async () => {
    const r = await post('/auth/register', { role: 'autorite', name: 'Pirate', phone: '0700000005', password: 'motdepasse1' });
    expect(r.statusCode).toBe(422);
  });
  it('l’inscription échouée n’a laissé aucun compte (transaction)', async () => {
    const rows = await ctx.db.query("SELECT 1 FROM users WHERE phone = '0700000004'");
    expect(rows.length).toBe(0);
  });
});

describe('connexion', () => {
  it('par téléphone, e-mail', async () => {
    expect((await login(ctx.app, '07 12 34 56 78')).res.statusCode).toBe(200);
    expect((await login(ctx.app, 'Awa@Demo.ci')).res.statusCode).toBe(200);
  });
  it('mauvais mot de passe et compte inconnu : même réponse', async () => {
    const a = await login(ctx.app, '0712345678', 'faux-mot-de-passe');
    const b = await login(ctx.app, '0600000000', 'faux-mot-de-passe');
    expect(a.res.statusCode).toBe(401);
    expect(b.res.statusCode).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.code).toBe('invalid_credentials');
  });
  it('GET /me exige un jeton valide', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/me', headers: bearer('abc.def.ghi') })).json().code).toBe('invalid_token');
  });
  it('GET /me renvoie le profil', async () => {
    const { body } = await login(ctx.app, '0712345678');
    const r = await ctx.app.inject({ method: 'GET', url: '/me', headers: bearer(body.accessToken) });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe('Awa Koné');
    expect(r.json().zone.name).toBe('Korhogo');
  });
});

describe('verrouillage du compte', () => {
  it('bloque après 5 échecs, même avec le bon mot de passe, puis se libère', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(ctx.app, '0723456789', 'faux-mot-de-passe')).res.statusCode).toBe(401);
    }
    const locked = await login(ctx.app, '0723456789');
    expect(locked.res.statusCode).toBe(429);
    expect(locked.body.code).toBe('account_locked');
    expect(locked.res.headers['retry-after']).toBeTruthy();
    // le verrou expire : on le recule dans le temps
    await ctx.db.query("UPDATE users SET locked_until = now() - interval '1 minute' WHERE phone = '0723456789'");
    const again = await login(ctx.app, '0723456789');
    expect(again.res.statusCode).toBe(200);
    const row = (await ctx.db.query("SELECT failed_attempts, locked_until FROM users WHERE phone = '0723456789'"))[0]!;
    expect(row.failed_attempts).toBe(0);
    expect(row.locked_until).toBeNull();
  });
  it('une réussite remet le compteur à zéro', async () => {
    await login(ctx.app, '0501020304', 'faux-mot-de-passe');
    await login(ctx.app, '0501020304', 'faux-mot-de-passe');
    expect((await login(ctx.app, '0501020304')).res.statusCode).toBe(200);
    const row = (await ctx.db.query("SELECT failed_attempts FROM users WHERE phone = '0501020304'"))[0]!;
    expect(row.failed_attempts).toBe(0);
  });
});

describe('connexion par code à 4 chiffres (mode simple)', () => {
  it('fonctionne par téléphone et par userId', async () => {
    const a = await post('/auth/pin-login', { phone: '07 12 34 56 78', pin: '1234' });
    expect(a.statusCode).toBe(200);
    const b = await post('/auth/pin-login', { userId: a.json().user.id, pin: '1234' });
    expect(b.statusCode).toBe(200);
  });
  it('refuse un mauvais code et un format invalide', async () => {
    expect((await post('/auth/pin-login', { phone: '0712345678', pin: '9999' })).statusCode).toBe(401);
    expect((await post('/auth/pin-login', { phone: '0712345678', pin: '12ab' })).statusCode).toBe(422);
  });
  it('est réservé aux éleveurs', async () => {
    const r = await post('/auth/pin-login', { phone: '0501020304', pin: '1234' });
    expect(r.statusCode).toBe(401);
  });
  it('se verrouille comme le mot de passe', async () => {
    for (let i = 0; i < 5; i++) await post('/auth/pin-login', { phone: '0799887766', pin: '0000' });
    const r = await post('/auth/pin-login', { phone: '0799887766', pin: '2468' });
    expect(r.statusCode).toBe(429);
  });
  it('POST /auth/pin change le code (mot de passe requis)', async () => {
    const { body } = await login(ctx.app, '0712345678');
    const bad = await post('/auth/pin', { password: 'faux-mot-de-passe', pin: '5555' }, bearer(body.accessToken));
    expect(bad.statusCode).toBe(401);
    const ok = await post('/auth/pin', { password: 'Demo1234!', pin: '5555' }, bearer(body.accessToken));
    expect(ok.statusCode).toBe(204);
    expect((await post('/auth/pin-login', { phone: '0712345678', pin: '5555' })).statusCode).toBe(200);
  });
});

describe('renouvellement des jetons', () => {
  it('fait tourner le jeton et refuse son rejeu en révoquant la famille', async () => {
    const { body } = await login(ctx.app, '0102030405');
    const r1 = await post('/auth/refresh', { refreshToken: body.refreshToken });
    expect(r1.statusCode).toBe(200);
    const next = r1.json();
    expect(next.refreshToken).not.toBe(body.refreshToken);

    const replay = await post('/auth/refresh', { refreshToken: body.refreshToken });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('refresh_reuse');

    // la famille entière est révoquée : le jeton le plus récent ne marche plus
    const after = await post('/auth/refresh', { refreshToken: next.refreshToken });
    expect(after.statusCode).toBe(401);
  });
  it('refuse un jeton inconnu', async () => {
    const r = await post('/auth/refresh', { refreshToken: 'x'.repeat(43) });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('invalid_refresh');
  });
  it('refuse un jeton expiré', async () => {
    const { body } = await login(ctx.app, '0102030405');
    await ctx.db.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 day'");
    expect((await post('/auth/refresh', { refreshToken: body.refreshToken })).statusCode).toBe(401);
  });
  it('logout révoque la session et peut être répété', async () => {
    const { body } = await login(ctx.app, '0102030405');
    expect((await post('/auth/logout', { refreshToken: body.refreshToken })).statusCode).toBe(204);
    expect((await post('/auth/logout', { refreshToken: body.refreshToken })).statusCode).toBe(204);
    expect((await post('/auth/refresh', { refreshToken: body.refreshToken })).statusCode).toBe(401);
  });
  it('le jeton de renouvellement n’est jamais stocké en clair', async () => {
    const { body } = await login(ctx.app, '0102030405');
    const rows = await ctx.db.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [body.refreshToken]);
    expect(rows.length).toBe(0);
  });
});

describe('profil', () => {
  it('PATCH /me modifie nom, zone et préférences', async () => {
    const { body } = await login(ctx.app, '0712345678');
    const zones = (await ctx.app.inject({ method: 'GET', url: '/zones' })).json().items;
    const r = await ctx.app.inject({
      method: 'PATCH', url: '/me', headers: bearer(body.accessToken),
      payload: { name: 'Awa Koné-Diaby', zoneId: zones[0].id, prefs: { lang: 'fr', simple: true } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe('Awa Koné-Diaby');
    expect(r.json().zone.id).toBe(zones[0].id);
    expect(r.json().prefs).toEqual({ lang: 'fr', simple: true });
  });
  it('refuse un téléphone déjà pris et une zone inconnue', async () => {
    const { body } = await login(ctx.app, '0712345678');
    const h = bearer(body.accessToken);
    expect((await ctx.app.inject({ method: 'PATCH', url: '/me', headers: h, payload: { phone: '0501020304' } })).statusCode).toBe(409);
    expect((await ctx.app.inject({ method: 'PATCH', url: '/me', headers: h, payload: { zoneId: '11111111-1111-4111-8111-111111111111' } })).statusCode).toBe(422);
    expect((await ctx.app.inject({ method: 'PATCH', url: '/me', headers: h, payload: {} })).statusCode).toBe(422);
  });
  it('ne permet pas de changer son rôle', async () => {
    const { body } = await login(ctx.app, '0712345678');
    const r = await ctx.app.inject({ method: 'PATCH', url: '/me', headers: bearer(body.accessToken), payload: { role: 'autorite', name: 'Awa' } });
    expect(r.json().role).toBe('eleveur');
  });
  it('changement de mot de passe : ferme les autres sessions', async () => {
    const reg = await post('/auth/register', { role: 'eleveur', name: 'Test Mdp', phone: '0700000010', password: 'ancienmdp1' });
    const { accessToken, refreshToken } = reg.json();
    const r = await post('/auth/change-password', { currentPassword: 'ancienmdp1', newPassword: 'nouveaumdp1' }, bearer(accessToken));
    expect(r.statusCode).toBe(204);
    expect((await post('/auth/refresh', { refreshToken })).statusCode).toBe(401);
    expect((await login(ctx.app, '0700000010', 'ancienmdp1')).res.statusCode).toBe(401);
    expect((await login(ctx.app, '0700000010', 'nouveaumdp1')).res.statusCode).toBe(200);
  });
});

describe('vétérinaires et rôles', () => {
  it('GET /vets liste seulement les vétérinaires vérifiés', async () => {
    const { body } = await login(ctx.app, '0712345678');
    const r = await ctx.app.inject({ method: 'GET', url: '/vets', headers: bearer(body.accessToken) });
    expect(r.statusCode).toBe(200);
    const items = r.json().items;
    expect(items.map((v: any) => v.name)).toContain('Dr Yao Kouadio');
    expect(items.map((v: any) => v.name)).not.toContain('Dr Test');
  });
  it('seule une autorité valide un vétérinaire', async () => {
    const reg = await ctx.db.query("SELECT user_id FROM vets WHERE order_number = 'ONV-CI-9999'");
    const id = reg[0]!.user_id;
    const eleveur = (await login(ctx.app, '0712345678')).body;
    const denied = await post(`/vets/${id}/verify`, {}, bearer(eleveur.accessToken));
    expect(denied.statusCode).toBe(403);
    const autorite = (await login(ctx.app, '0505050505')).body;
    const ok = await post(`/vets/${id}/verify`, {}, bearer(autorite.accessToken));
    expect(ok.statusCode).toBe(200);
    expect((await ctx.db.query('SELECT verified FROM vets WHERE user_id = $1', [id]))[0]!.verified).toBe(true);
    const audit = await ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'vet.verified'");
    expect(audit.length).toBe(1);
    const missing = await post('/vets/11111111-1111-4111-8111-111111111111/verify', {}, bearer(autorite.accessToken));
    expect(missing.statusCode).toBe(404);
  });
});

describe('vétérinaires en attente et recherche d’éleveur', () => {
  it('GET /vets/pending : réservé à l’autorité, liste les non vérifiés', async () => {
    await post('/auth/register', { role: 'vet', name: 'Dr Attente', phone: '0700000077', password: 'motdepasse1', orderNumber: 'ONV-CI-7777' });
    const eleveur = (await login(ctx.app, '0712345678')).body;
    const denied = await ctx.app.inject({ method: 'GET', url: '/vets/pending', headers: bearer(eleveur.accessToken) });
    expect(denied.statusCode).toBe(403);
    const autorite = (await login(ctx.app, '0505050505')).body;
    const ok = await ctx.app.inject({ method: 'GET', url: '/vets/pending', headers: bearer(autorite.accessToken) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().items.some((v: any) => v.orderNumber === 'ONV-CI-7777')).toBe(true);
  });
  it('GET /eleveurs/lookup : trouve un éleveur, jamais soi-même ni un non-éleveur', async () => {
    await post('/auth/register', { role: 'eleveur', name: 'Voisin', phone: '0700000078', password: 'motdepasse1' });
    const eleveur = (await login(ctx.app, '0712345678')).body;
    const get = (phone: string) => ctx.app.inject({ method: 'GET', url: `/eleveurs/lookup?phone=${encodeURIComponent(phone)}`, headers: bearer(eleveur.accessToken) });
    const ok = await get('07 00 00 00 78');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe('Voisin');
    expect(ok.json().phone).toBeUndefined();
    expect((await get('0712345678')).statusCode).toBe(404);
    expect((await get('0505050505')).statusCode).toBe(404);
    expect((await get('0799999999')).json().code).toBe('user_not_found');
  });
});
