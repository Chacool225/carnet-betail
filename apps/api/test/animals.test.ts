import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let awa: string, seydou: string, vet: string, agent: string, autorite: string;
beforeAll(async () => {
  ctx = await setup();
  awa = (await login(ctx.app, '0712345678')).body.accessToken;
  seydou = (await login(ctx.app, '0723456789')).body.accessToken;
  vet = (await login(ctx.app, '0501020304')).body.accessToken;
  agent = (await login(ctx.app, '0102030405')).body.accessToken;
  autorite = (await login(ctx.app, '0505050505')).body.accessToken;
});
afterAll(async () => { await ctx.close(); });

const call = (method: string, url: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { ...bearer(token), ...headers } });

const cow = { species: 'bovin', kind: 'individual', name: 'Bella', sex: 'F', breed: 'Baoulé', bornOn: '2024-01-10' };

describe('création', () => {
  it('crée un bovin avec un code public et une entrée d’audit', async () => {
    const r = await call('POST', '/animals', awa, cow);
    expect(r.statusCode).toBe(201);
    const a = r.json();
    expect(a.code).toMatch(/^CI-BOV-\d{5}$/);
    expect(a.zone.name).toBe('Korhogo'); // zone du profil par défaut
    expect(a.owner.name).toBe('Awa Koné');
    expect(a.qty).toBeNull();
    expect((await ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'animal.created' AND animal_id = $1", [a.id])).length).toBe(1);
  });
  it('les codes sont uniques et croissants', async () => {
    const a = (await call('POST', '/animals', awa, { ...cow, name: 'A' })).json();
    const b = (await call('POST', '/animals', awa, { ...cow, name: 'B' })).json();
    expect(a.code).not.toBe(b.code);
    expect(Number(b.code.slice(-5))).toBeGreaterThan(Number(a.code.slice(-5)));
  });
  it('crée un lot de volaille et note l’entrée dans l’historique', async () => {
    const r = await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name: 'Bande 2', qty: 200 });
    expect(r.statusCode).toBe(201);
    expect(r.json().qty).toBe(200);
    expect(r.json().qtyInitial).toBe(200);
    expect(r.json().code).toMatch(/^CI-VOL-/);
    const f = await ctx.db.query("SELECT type, qty FROM flows WHERE animal_id = $1", [r.json().id]);
    expect(f).toEqual([{ type: 'entree', qty: 200 }]);
  });
  it('règles d’espèce et de type', async () => {
    expect((await call('POST', '/animals', awa, { species: 'volaille', kind: 'individual', name: 'X' })).statusCode).toBe(422);
    expect((await call('POST', '/animals', awa, { species: 'bovin', kind: 'lot', name: 'X', qty: 5 })).statusCode).toBe(422);
    expect((await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name: 'X' })).statusCode).toBe(422);
    expect((await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name: 'X', qty: 0 })).statusCode).toBe(422);
    expect((await call('POST', '/animals', awa, { species: 'volaille', kind: 'lot', name: 'X', qty: 5, rfid: 'AAAAAAAAAA' })).statusCode).toBe(422);
    expect((await call('POST', '/animals', awa, { ...cow, qty: 3 })).statusCode).toBe(422);
    expect((await call('POST', '/animals', awa, { species: 'porcin', kind: 'lot', name: 'Porcelets', qty: 8 })).statusCode).toBe(201);
    expect((await call('POST', '/animals', awa, { species: 'porcin', kind: 'individual', name: 'Truie' })).statusCode).toBe(201);
  });
  it('refuse une date de naissance future ou mal écrite', async () => {
    expect((await call('POST', '/animals', awa, { ...cow, bornOn: '2999-01-01' })).statusCode).toBe(422);
    expect((await call('POST', '/animals', awa, { ...cow, bornOn: '10/01/2024' })).statusCode).toBe(422);
  });
  it('seul un éleveur crée une fiche', async () => {
    expect((await call('POST', '/animals', vet, cow)).statusCode).toBe(403);
    expect((await call('POST', '/animals', agent, cow)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'POST', url: '/animals', payload: cow })).statusCode).toBe(401);
  });
  it('RG8 : une boucle RFID, une seule fiche', async () => {
    const ok = await call('POST', '/animals', awa, { ...cow, name: 'Boucle', rfid: 'aabbccddeeff' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().rfid).toBe('AABBCCDDEEFF'); // normalisé en majuscules
    const dup = await call('POST', '/animals', seydou, { ...cow, name: 'Copie', rfid: 'AABBCCDDEEFF', zoneId: ok.json().zone.id });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('rfid_taken');
  });
  it('un échec de création ne laisse rien (transaction)', async () => {
    const before = (await ctx.db.query('SELECT count(*)::int AS n FROM animals'))[0]!.n;
    await call('POST', '/animals', awa, { ...cow, name: 'Raté', rfid: 'AABBCCDDEEFF' });
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM animals'))[0]!.n).toBe(before);
  });
  it('rejoue une création avec la même Idempotency-Key sans doublon', async () => {
    const h = { 'idempotency-key': 'animal-create-0001' };
    const a = await call('POST', '/animals', awa, { ...cow, name: 'Une seule' }, h);
    const b = await call('POST', '/animals', awa, { ...cow, name: 'Une seule' }, h);
    expect(b.headers['idempotency-replayed']).toBe('true');
    expect(b.json().id).toBe(a.json().id);
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM animals WHERE name = 'Une seule'"))[0]!.n).toBe(1);
  });
});

describe('visibilité par rôle', () => {
  it('l’éleveur ne voit que ses animaux', async () => {
    const r = (await call('GET', '/animals?limit=100', awa)).json();
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((a: any) => a.owner.name === 'Awa Koné')).toBe(true);
  });
  it('un éleveur ne peut pas ouvrir la fiche d’un autre (404)', async () => {
    expect((await call('GET', '/animals/00000000-0000-4000-8000-0000000001a1', awa)).statusCode).toBe(404);
    expect((await call('GET', '/animals/00000000-0000-4000-8000-0000000001a1', seydou)).statusCode).toBe(200);
  });
  it('le vétérinaire ne voit que les animaux avec accès en cours (RG1)', async () => {
    const list = (await call('GET', '/animals', vet)).json();
    expect(list.items.map((a: any) => a.code)).toEqual(['CI-BOV-00431']);
    expect((await call('GET', '/animals/00000000-0000-4000-8000-0000000001a2', vet)).statusCode).toBe(404);
    // l'accès expire : il ne voit plus rien
    await ctx.db.query("UPDATE access_grants SET granted_on = current_date - 40, expires_on = current_date - 1");
    expect((await call('GET', '/animals', vet)).json().total).toBe(0);
    expect((await call('GET', '/animals/00000000-0000-4000-8000-0000000001a1', vet)).statusCode).toBe(404);
    await ctx.db.query("UPDATE access_grants SET expires_on = current_date + 30");
    expect((await call('GET', '/animals/00000000-0000-4000-8000-0000000001a1', vet)).json().access).toBe('vet');
  });
  it('l’agent voit sa zone (Ferkessédougou), l’autorité voit tout', async () => {
    const a = (await call('GET', '/animals?limit=100', agent)).json();
    expect(a.items.map((x: any) => x.code)).toEqual(['CI-BOV-00431']);
    const all = (await call('GET', '/animals?limit=100', autorite)).json();
    expect(all.total).toBeGreaterThan(a.total);
  });
});

describe('liste : recherche, filtres, tri, pagination', () => {
  it('recherche par nom, code, race et boucle', async () => {
    expect((await call('GET', '/animals?q=tachet', awa)).json().items.map((a: any) => a.name)).toContain('Tacheté');
    expect((await call('GET', '/animals?q=CI-VOL-00101', awa)).json().total).toBe(1);
    expect((await call('GET', '/animals?q=zébu', awa)).json().total).toBe(1);
  });
  it('les caractères % et _ sont cherchés tels quels', async () => {
    expect((await call('GET', '/animals?q=%25', awa)).json().total).toBe(0);
    expect((await call('GET', '/animals?q=_', awa)).json().total).toBe(0);
  });
  it('filtres espèce, type, statut', async () => {
    expect((await call('GET', '/animals?species=volaille&limit=100', awa)).json().items.every((a: any) => a.species === 'volaille')).toBe(true);
    expect((await call('GET', '/animals?kind=lot&limit=100', awa)).json().items.every((a: any) => a.kind === 'lot')).toBe(true);
    expect((await call('GET', '/animals?status=vole', awa)).json().total).toBe(0);
  });
  it('tri par nom et pagination', async () => {
    const asc = (await call('GET', '/animals?sort=name&order=asc&limit=100', awa)).json();
    const desc = (await call('GET', '/animals?sort=name&order=desc&limit=100', awa)).json();
    expect(desc.items.map((a: any) => a.id)).toEqual([...asc.items.map((a: any) => a.id)].reverse());
    const p1 = (await call('GET', '/animals?sort=name&order=asc&limit=2&page=1', awa)).json();
    const p2 = (await call('GET', '/animals?sort=name&order=asc&limit=2&page=2', awa)).json();
    expect(p1.items.length).toBe(2);
    expect(p1.total).toBe(asc.total);
    expect(p1.items[0].id).not.toBe(p2.items[0].id);
  });
  it('refuse un tri ou une limite hors liste (422)', async () => {
    expect((await call('GET', '/animals?sort=owner_id', awa)).statusCode).toBe(422);
    expect((await call('GET', '/animals?limit=1000', awa)).statusCode).toBe(422);
  });
});

describe('scan (lookup)', () => {
  it('par code ou par boucle, pour tout utilisateur connecté', async () => {
    const byCode = await call('GET', '/animals/lookup?code=ci-bov-00431', vet);
    expect(byCode.statusCode).toBe(200);
    expect(byCode.json().ownerName).toBe('Seydou Traoré');
    expect(byCode.json().access).toBe('vet');
    const byRfid = await call('GET', '/animals/lookup?rfid=0a1b2c3d4e5f', awa);
    expect(byRfid.json().code).toBe('CI-BOV-00431');
    expect(byRfid.json().access).toBeNull(); // carte publique seulement, pas le dossier
    expect(byRfid.json()).not.toHaveProperty('breed');
  });
  it('404 si inconnu, 422 si les deux ou aucun paramètre', async () => {
    expect((await call('GET', '/animals/lookup?code=CI-BOV-99999', awa)).json().code).toBe('animal_not_found');
    expect((await call('GET', '/animals/lookup', awa)).statusCode).toBe(422);
    expect((await call('GET', '/animals/lookup?code=CI-BOV-00431&rfid=0A1B2C3D4E5F', awa)).statusCode).toBe(422);
  });
});

describe('modification', () => {
  let id: string;
  beforeAll(async () => { id = (await call('POST', '/animals', awa, { ...cow, name: 'À modifier' })).json().id; });

  it('le propriétaire modifie sa fiche', async () => {
    const r = await call('PATCH', `/animals/${id}`, awa, { name: 'Modifiée', avgWeightKg: 312.5, breed: null });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe('Modifiée');
    expect(r.json().avgWeightKg).toBe(312.5);
    expect(r.json().breed).toBeNull();
  });
  it('ni code, ni propriétaire, ni statut ne se modifient par cette route', async () => {
    const r = await call('PATCH', `/animals/${id}`, awa, { name: 'Même', code: 'CI-XXX-1', ownerId: '00000000-0000-4000-8000-0000000000a2', status: 'vendu' });
    expect(r.json().code).not.toBe('CI-XXX-1');
    expect(r.json().owner.name).toBe('Awa Koné');
    expect(r.json().status).toBe('actif');
  });
  it('un autre éleveur reçoit 404, un vétérinaire avec accès reçoit 403', async () => {
    expect((await call('PATCH', `/animals/${id}`, seydou, { name: 'Vol' })).statusCode).toBe(404);
    expect((await call('PATCH', '/animals/00000000-0000-4000-8000-0000000001a1', vet, { name: 'Non' })).statusCode).toBe(403);
    expect((await call('PATCH', '/animals/00000000-0000-4000-8000-0000000001a1', autorite, { name: 'Non' })).statusCode).toBe(403);
  });
  it('la boucle se pose une fois, puis ne change plus', async () => {
    const first = await call('PATCH', `/animals/${id}`, awa, { rfid: '1122334455AA' });
    expect(first.statusCode).toBe(200);
    expect(first.json().rfid).toBe('1122334455AA');
    expect((await ctx.db.query("SELECT 1 FROM flows WHERE animal_id = $1 AND type = 'identification'", [id])).length).toBe(1);
    expect((await call('PATCH', `/animals/${id}`, awa, { rfid: '1122334455AA' })).statusCode).toBe(200);
    expect((await call('PATCH', `/animals/${id}`, awa, { rfid: '1122334455BB' })).json().code).toBe('rfid_immutable');
  });
  it('refuse une boucle prise ailleurs', async () => {
    const other = (await call('POST', '/animals', awa, { ...cow, name: 'Sans boucle' })).json().id;
    expect((await call('PATCH', `/animals/${other}`, awa, { rfid: '1122334455AA' })).json().code).toBe('rfid_taken');
  });
  it('un lot n’a ni boucle ni sexe', async () => {
    const lot = '00000000-0000-4000-8000-0000000001a3';
    expect((await call('PATCH', `/animals/${lot}`, awa, { rfid: '1122334455CC' })).statusCode).toBe(422);
    expect((await call('PATCH', `/animals/${lot}`, awa, { sex: 'M' })).statusCode).toBe(422);
  });
  it('RG4 : un animal volé est bloqué', async () => {
    await ctx.db.query("UPDATE animals SET status = 'vole' WHERE id = $1", [id]);
    const r = await call('PATCH', `/animals/${id}`, awa, { name: 'Bloqué' });
    expect(r.statusCode).toBe(423);
    expect(r.json().code).toBe('animal_locked');
    expect((await call('POST', `/animals/${id}/photos`, awa, { url: 'https://exemple.ci/a.jpg' })).statusCode).toBe(423);
    expect((await call('GET', `/animals/lookup?code=${(await call('GET', `/animals/${id}`, awa)).json().code}`, vet)).json().stolen).toBe(true);
    await ctx.db.query("UPDATE animals SET status = 'actif' WHERE id = $1", [id]);
  });
});

describe('photos (RG10)', () => {
  let id: string;
  beforeAll(async () => { id = (await call('POST', '/animals', awa, { ...cow, name: 'Photogénique' })).json().id; });
  const photo = (n: number) => ({ url: `https://exemple.ci/p${n}.jpg` });

  it('refuse une adresse qui n’est ni https ni /uploads/', async () => {
    expect((await call('POST', `/animals/${id}/photos`, awa, { url: 'javascript:alert(1)' })).statusCode).toBe(422);
    expect((await call('POST', `/animals/${id}/photos`, awa, { url: 'http://exemple.ci/a.jpg' })).statusCode).toBe(422);
    expect((await call('POST', `/animals/${id}/photos`, awa, { url: '/uploads/a/b.jpg' })).statusCode).toBe(201);
  });
  it('dix photos au maximum, la onzième est refusée', async () => {
    for (let i = 1; i <= 9; i++) expect((await call('POST', `/animals/${id}/photos`, awa, photo(i))).statusCode).toBe(201);
    const r = await call('POST', `/animals/${id}/photos`, awa, photo(10));
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('photo_limit');
    expect((await call('GET', `/animals/${id}`, awa)).json().photos.length).toBe(10);
  });
  it('la suppression libère une place', async () => {
    const photos = (await call('GET', `/animals/${id}`, awa)).json().photos;
    expect((await call('DELETE', `/animals/${id}/photos/${photos[0].id}`, awa)).statusCode).toBe(204);
    expect((await call('DELETE', `/animals/${id}/photos/${photos[0].id}`, awa)).statusCode).toBe(404);
    expect((await call('POST', `/animals/${id}/photos`, awa, photo(11))).statusCode).toBe(201);
  });
  it('un autre éleveur ne peut ni ajouter ni supprimer', async () => {
    expect((await call('POST', `/animals/${id}/photos`, seydou, photo(12))).statusCode).toBe(404);
  });
  it('deux ajouts simultanés ne dépassent jamais la limite', async () => {
    const fresh = (await call('POST', '/animals', awa, { ...cow, name: 'Course' })).json().id;
    for (let i = 1; i <= 9; i++) await call('POST', `/animals/${fresh}/photos`, awa, photo(i));
    const rs = await Promise.all([1, 2, 3].map((i) => call('POST', `/animals/${fresh}/photos`, awa, photo(100 + i))));
    expect(rs.filter((r) => r.statusCode === 201).length).toBe(1);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM animal_photos WHERE animal_id = $1', [fresh]))[0]!.n).toBe(10);
  });
});
