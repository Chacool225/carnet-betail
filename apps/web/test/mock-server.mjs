// Faux serveur d'API (sous-ensemble du contrat) pour tester l'interface sans base de données.
// Il imite les formes de réponse de packages/contract/openapi.yaml, dont /sync (clientId rejoué sans doublon).
// Ce n'est PAS le vrai backend : il ne prouve rien sur lui.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ZONES = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Korhogo', lat: null, lng: null }, { id: '00000000-0000-4000-8000-000000000002', name: 'Bouaké', lat: null, lng: null }];
const mkUser = (o) => ({ id: randomUUID(), email: null, photoUrl: null, vet: null, prefs: {}, createdAt: new Date().toISOString(), zone: { id: ZONES[0].id, name: ZONES[0].name }, ...o });
export function createMock({ staticDir } = {}) {
  const users = [
    { ...mkUser({ role: 'eleveur', name: 'Awa Koné', phone: '0712345678' }), password: 'Demo1234!' },
    { ...mkUser({ role: 'autorite', name: 'Direction Élevage', phone: '0505050505', zone: null }), password: 'Demo1234!' },
    { ...mkUser({ role: 'vet', name: 'Dr Traoré', phone: '0700000010', vet: { orderNumber: 'ONV-1', clinic: null, verified: false } }), password: 'Demo1234!' },
  ];
  const animals = []; const events = []; const cases = []; const flows = []; const seen = new Map(); const tokens = new Map();
  const stats = { syncCalls: 0, createdAnimals: 0 };
  let seq = 0;
  const owner = users[0];
  const card = (a) => ({ ...a, zone: { id: ZONES[0].id, name: ZONES[0].name }, owner: { id: a.ownerId, name: owner.name }, photos: [], access: 'owner' });
  const fail = (status, code, message, details) => ({ status, body: { code, message, ...(details ? { details } : {}) } });
  const pub = ({ password, ...u }) => u;

  const ops = {
    'animal.create': (p, u) => {
      if (!p.name || p.name.length < 1) return fail(422, 'validation_error', 'Données invalides', [{ path: ['name'], message: 'Nom obligatoire.' }]);
      if (p.kind === 'lot' && !(p.qty > 0)) return fail(422, 'validation_error', 'Données invalides', [{ path: ['qty'], message: 'Effectif obligatoire.' }]);
      const a = { id: randomUUID(), code: `CI-BOV-${String(++seq).padStart(5, '0')}`, kind: p.kind, species: p.species, breed: p.breed ?? null, name: p.name, sex: p.sex ?? null, bornOn: p.bornOn ?? null, status: 'actif', qty: p.kind === 'lot' ? p.qty : null, qtyInitial: p.kind === 'lot' ? p.qty : null, avgWeightKg: p.avgWeightKg ?? null, rfid: p.rfid ?? null, ownerId: u.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      animals.push(a); stats.createdAnimals++;
      return { status: 201, body: { id: a.id, code: a.code } };
    },
    'animal.update': (p) => { const a = animals.find((x) => x.id === p.animalId); if (!a) return fail(404, 'not_found', 'Introuvable'); if (p.baseUpdatedAt && p.baseUpdatedAt !== a.updatedAt) return fail(409, 'conflict_stale', 'Modifié ailleurs'); Object.assign(a, { name: p.name ?? a.name, breed: p.breed ?? a.breed, updatedAt: new Date().toISOString() }); return { status: 200, body: { id: a.id } }; },
    'health.create': (p, u) => {
      const a = animals.find((x) => x.id === p.animalId); if (!a) return fail(404, 'not_found', 'Introuvable');
      const e = { id: randomUUID(), animalId: a.id, type: p.type, label: p.label, doneOn: p.doneOn, nextDueOn: p.nextDueOn ?? null, withdrawalDays: p.withdrawalDays ?? null, withdrawalUntil: p.withdrawalDays ? new Date(Date.now() + p.withdrawalDays * 864e5).toISOString().slice(0, 10) : null, note: p.note ?? null, recordedBy: { id: u.id, name: u.name, role: u.role }, vet: null, signedByVet: false, correctsEventId: p.correctsEventId ?? null, correctedBy: null, createdAt: new Date().toISOString() };
      if (p.correctsEventId) { const o = events.find((x) => x.id === p.correctsEventId); if (o) o.correctedBy = e.id; }
      events.push(e); return { status: 201, body: { id: e.id } };
    },
    'mortality.declare': (p) => { const a = animals.find((x) => x.id === p.animalId); if (!a) return fail(404, 'not_found', 'x'); if (a.kind === 'lot') { if (p.qty > a.qty) return fail(409, 'qty_exceeds_stock', 'trop', { available: a.qty }); a.qty -= p.qty; if (!a.qty) a.status = 'decede'; } else a.status = 'decede'; return { status: 201, body: { id: a.id, qty: a.qty, status: a.status } }; },
    'case.create': (p, u) => { const c = { id: randomUUID(), animalId: p.animalId, diseases: p.diseases, notifiable: false, affectedCount: p.affectedCount, severity: p.severity, symptoms: p.symptoms ?? [], deaths: p.deaths ?? 0, status: 'ouvert', note: null, openedOn: new Date().toISOString().slice(0, 10), closedOn: null, openedBy: { id: u.id, name: u.name } }; cases.push(c); return { status: 201, body: { id: c.id } }; },
    'case.update': (p) => { const c = cases.find((x) => x.id === p.caseId); if (!c) return fail(404, 'not_found', 'x'); c.status = p.status ?? c.status; return { status: 200, body: { id: c.id, status: c.status } }; },
    sale: (p) => { const a = animals.find((x) => x.id === p.animalId); if (!a) return fail(404, 'not_found', 'x'); const w = events.filter((e) => e.animalId === a.id && e.withdrawalUntil).map((e) => e.withdrawalUntil).sort().pop(); if (w && w > new Date().toISOString().slice(0, 10)) return fail(409, 'withdrawal_active', 'délai', { until: w }); a.status = 'vendu'; flows.push({ id: randomUUID(), animalId: a.id, type: 'vente', qty: p.qty ?? null, counterpart: p.counterpart ?? null, note: null, occurredOn: p.occurredOn, recordedBy: { id: owner.id, name: owner.name }, createdAt: new Date().toISOString() }); return { status: 201, body: { id: a.id, status: a.status, qty: a.qty } }; },
    'theft.declare': (p) => { const a = animals.find((x) => x.id === p.animalId); if (!a) return fail(404, 'not_found', 'x'); a.status = 'vole'; return { status: 201, body: { id: a.id, status: a.status } }; },
  };

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const auth = (req) => tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));
  const session = (u) => { const at = 'at-' + randomUUID(), rt = 'rt-' + randomUUID(); tokens.set(at, u); tokens.set(rt, u); return { accessToken: at, refreshToken: rt, tokenType: 'Bearer', expiresIn: 900, user: pub(u) }; };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x'); const path = url.pathname.replace(/^\/api/, '');
    if (!url.pathname.startsWith('/api')) return serveStatic(req, res, url.pathname);
    let body = {}; if (req.method !== 'GET') { const c = []; for await (const x of req) c.push(x); try { body = JSON.parse(Buffer.concat(c).toString() || '{}'); } catch { /* vide */ } }
    const q = url.searchParams; const u = auth(req);
    if (path === '/zones') return json(res, 200, { items: ZONES });
    if (path === '/auth/login') { const x = users.find((y) => y.phone === String(body.identifier).replace(/\s/g, '') && y.password === body.password); return x ? json(res, 200, session(x)) : json(res, 401, { code: 'invalid_credentials', message: 'Identifiants incorrects.' }); }
    if (path === '/auth/refresh') { const x = tokens.get(body.refreshToken); return x ? json(res, 200, session(x)) : json(res, 401, { code: 'invalid_token', message: 'Session expirée.' }); }
    if (path === '/auth/logout') return json(res, 204, {});
    if (!u) return json(res, 401, { code: 'unauthorized', message: 'Connexion requise.' });
    if (path === '/me' && req.method === 'GET') return json(res, 200, pub(u));
    if (path === '/me' && req.method === 'PATCH') { Object.assign(u, body); return json(res, 200, pub(u)); }
    if (path === '/reminders') return json(res, 200, { items: events.filter((e) => e.nextDueOn).map((e) => ({ eventId: e.id, animal: { id: e.animalId, code: '', name: animals.find((a) => a.id === e.animalId)?.name }, type: e.type, label: e.label, dueOn: e.nextDueOn, overdue: false })) });
    if (path === '/alerts') return json(res, 200, { items: [], total: 0, page: 1, limit: 20 });
    if (path === '/access') return json(res, 200, { items: [] });
    if (path === '/animals' && req.method === 'GET') {
      let l = animals.filter((a) => (!q.get('status') || a.status === q.get('status')) && (!q.get('q') || (a.name + a.code).toLowerCase().includes(q.get('q').toLowerCase())) && (!q.get('species') || a.species === q.get('species')));
      return json(res, 200, { items: l.map(card), total: l.length, page: 1, limit: 20 });
    }
    let m;
    if ((m = /^\/animals\/([^/]+)$/.exec(path))) { const a = animals.find((x) => x.id === m[1]); return a ? json(res, 200, card(a)) : json(res, 404, { code: 'not_found', message: 'Introuvable.' }); }
    if ((m = /^\/animals\/([^/]+)\/health-summary$/.exec(path))) { const w = events.filter((e) => e.animalId === m[1] && e.withdrawalUntil).map((e) => e.withdrawalUntil).sort().pop() ?? null; const act = w && w > new Date().toISOString().slice(0, 10); return json(res, 200, { withdrawalUntil: act ? w : null, canSell: !act, upcoming: [], lastEvent: events.filter((e) => e.animalId === m[1]).pop() ?? null }); }
    if ((m = /^\/animals\/([^/]+)\/health-events$/.exec(path))) return json(res, 200, { items: events.filter((e) => e.animalId === m[1]).reverse() });
    if ((m = /^\/animals\/([^/]+)\/cases$/.exec(path))) return json(res, 200, { items: cases.filter((c) => c.animalId === m[1]) });
    if ((m = /^\/animals\/([^/]+)\/flows$/.exec(path))) return json(res, 200, { items: flows.filter((f) => f.animalId === m[1]) });
    if ((m = /^\/animals\/([^/]+)\/access$/.exec(path))) return json(res, 200, { items: [] });
    if (path === '/vets/pending') return json(res, 200, { items: users.filter((x) => x.vet && !x.vet.verified).map((x) => ({ id: x.id, name: x.name, phone: x.phone, zone: 'Korhogo', clinic: null, orderNumber: x.vet.orderNumber, registeredAt: x.createdAt })) });
    if ((m = /^\/vets\/([^/]+)\/verify$/.exec(path))) { const x = users.find((y) => y.id === m[1]); x.vet.verified = true; return json(res, 200, { id: x.id, verified: true }); }
    if (path === '/stats/overview') return json(res, 200, { scope: 'national', periodDays: 30, animalsByStatus: [], activeBySpecies: [{ species: 'bovin', animals: animals.length, heads: animals.length }], topDiseases: [], openCases: cases.length, deaths: 0, unhandledAlerts: {}, vets: { total: 1, verified: 0 } });
    if (path === '/stats/zones') return json(res, 200, { items: [] });
    if (path === '/market') return json(res, 200, { items: [], total: 0, page: 1, limit: 20 });
    if (path === '/sync' && req.method === 'POST') {
      stats.syncCalls++;
      const results = body.ops.map((op) => {
        if (seen.has(op.clientId)) return { ...seen.get(op.clientId), replayed: true };
        const r = ops[op.type]?.(op.payload, u) ?? fail(422, 'unknown_op', 'Opération inconnue');
        const out = r.status < 300 ? { clientId: op.clientId, status: 'ok', replayed: false, result: r.body } : { clientId: op.clientId, status: 'error', replayed: false, error: { status: r.status, ...r.body } };
        seen.set(op.clientId, out); return out;
      });
      return json(res, 200, { results });
    }
    return json(res, 404, { code: 'not_found', message: 'Route inconnue : ' + path });
  };
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  function serveStatic(req, res, p) {
    let f = join(staticDir, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(staticDir, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
  }
  return { server: createServer(handler), stats, animals };
}
