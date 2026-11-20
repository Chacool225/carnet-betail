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
    { ...mkUser({ role: 'particulier', name: 'Koffi Yao', phone: '0700000099', zone: null }), password: 'Demo1234!' },
    { ...mkUser({ role: 'vet', name: 'Dr Traoré', phone: '0700000010', vet: { orderNumber: 'ONV-1', clinic: null, verified: false } }), password: 'Demo1234!' },
  ];
  const animals = []; const events = []; const cases = []; const flows = []; const seen = new Map(); const tokens = new Map();
  const stats = { syncCalls: 0, createdAnimals: 0, queries: [] };
  // Un animal vendu : il n'est plus dans le cheptel de l'éleveur mais son dossier archivé reste lisible.
  const FORMER_ID = '00000000-0000-4000-8000-0000000000aa';
  const former = { id: FORMER_ID, code: 'CI-BOV-90001', kind: 'individual', species: 'bovin', breed: 'Baoulé', name: 'Tacheté', sex: 'M', bornOn: '2023-02-01', qty: null, qtyInitial: null, avgWeightKg: null, rfid: null, status: 'vendu', createdAt: '2024-01-05T10:00:00Z', updatedAt: '2026-05-10T10:00:00Z' };
  const formerEvents = [
    { id: 'fe1', animalId: FORMER_ID, type: 'vaccin', label: 'Charbon symptomatique', doneOn: '2026-03-02', nextDueOn: null, withdrawalDays: null, withdrawalUntil: null, note: null, recordedBy: { id: 'x', name: 'Dr Traoré', role: 'vet' }, vet: null, signedByVet: true, correctsEventId: null, correctedBy: null, createdAt: '2026-03-02T09:00:00Z' },
    { id: 'fe2', animalId: FORMER_ID, type: 'soin', label: 'Vermifuge', doneOn: '2026-04-20', nextDueOn: null, withdrawalDays: null, withdrawalUntil: null, note: null, recordedBy: { id: 'x', name: 'Awa Koné', role: 'eleveur' }, vet: null, signedByVet: false, correctsEventId: null, correctedBy: null, createdAt: '2026-04-20T09:00:00Z' },
  ];
  const history = [];
  const log = (u, action, category, label, a) => history.push({ id: history.length + 1, at: new Date().toISOString(), action, category, label, byMe: true, actor: { id: u.id, name: u.name, role: u.role }, animal: a ? { id: a.id, code: a.code, name: a.name } : null });
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
      animals.push(a); stats.createdAnimals++; log(u, 'animal.created', 'animal', 'Création de la fiche', a);
      return { status: 201, body: { id: a.id, code: a.code } };
    },
    'animal.update': (p) => { const a = animals.find((x) => x.id === p.animalId); if (!a) return fail(404, 'not_found', 'Introuvable'); if (p.baseUpdatedAt && p.baseUpdatedAt !== a.updatedAt) return fail(409, 'conflict_stale', 'Modifié ailleurs'); Object.assign(a, { name: p.name ?? a.name, breed: p.breed ?? a.breed, updatedAt: new Date().toISOString() }); return { status: 200, body: { id: a.id } }; },
    'health.create': (p, u) => {
      const a = animals.find((x) => x.id === p.animalId); if (!a) return fail(404, 'not_found', 'Introuvable');
      const e = { id: randomUUID(), animalId: a.id, type: p.type, label: p.label, doneOn: p.doneOn, nextDueOn: p.nextDueOn ?? null, withdrawalDays: p.withdrawalDays ?? null, withdrawalUntil: p.withdrawalDays ? new Date(Date.now() + p.withdrawalDays * 864e5).toISOString().slice(0, 10) : null, note: p.note ?? null, recordedBy: { id: u.id, name: u.name, role: u.role }, vet: null, signedByVet: false, correctsEventId: p.correctsEventId ?? null, correctedBy: null, createdAt: new Date().toISOString() };
      if (p.correctsEventId) { const o = events.find((x) => x.id === p.correctsEventId); if (o) o.correctedBy = e.id; }
      events.push(e); log(u, 'health.recorded', 'sante', `${p.type === 'vaccin' ? 'Vaccin' : 'Soin'} : ${p.label}`, a); return { status: 201, body: { id: e.id } };
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
    if (path === '/auth/forgot-password') { stats.forgot = body.phone; res.writeHead(202, { 'content-type': 'application/json' }); return res.end('{"sent":true}'); }
    if (path === '/auth/reset-password') { if (body.code !== '123456') return json(res, 422, { code: 'validation_error', message: 'Code incorrect ou expiré.' }); stats.resetDone = true; res.writeHead(204); return res.end(); }
    if (path === '/auth/register' && req.method === 'POST') {
      if (users.some((y) => y.phone === body.phone)) return json(res, 409, { code: 'phone_taken', message: 'Ce numéro est déjà utilisé.' });
      const nu = { ...mkUser({ role: body.role, name: body.name, phone: body.phone, zone: null }), password: body.password }; users.push(nu);
      if (body.buyerProfile) { (stats.profiles ??= new Map()).set(nu.id, { profession: null, orgKind: null, orgName: null, contactName: null, contactPhone: null, locality: null, ...body.buyerProfile }); stats.registeredProfile = body.buyerProfile; }
      return json(res, 201, session(nu));
    }
    if (path === '/auth/login') { const x = users.find((y) => y.phone === String(body.identifier).replace(/\s/g, '') && y.password === body.password); return x ? json(res, 200, session(x)) : json(res, 401, { code: 'invalid_credentials', message: 'Identifiants incorrects.' }); }
    if (path === '/auth/refresh') { const x = tokens.get(body.refreshToken); return x ? json(res, 200, session(x)) : json(res, 401, { code: 'invalid_token', message: 'Session expirée.' }); }
    if (path === '/auth/logout') return json(res, 204, {});
    if (!u) return json(res, 401, { code: 'unauthorized', message: 'Connexion requise.' });
    if (path === '/me' && req.method === 'GET') return json(res, 200, pub(u));
    if (path === '/me' && req.method === 'PATCH') { Object.assign(u, body); return json(res, 200, pub(u)); }
    if (path === '/reminders') return json(res, 200, { items: events.filter((e) => e.nextDueOn).map((e) => ({ eventId: e.id, animal: { id: e.animalId, code: '', name: animals.find((a) => a.id === e.animalId)?.name }, type: e.type, label: e.label, dueOn: e.nextDueOn, overdue: false })) });
    stats.queries.push(path + url.search);
    if (path === '/alerts') return json(res, 200, { items: [], total: 0, page: 1, limit: 20 });
    if (path === '/me/history') {
      const f = (q.get('q') ?? '').toLowerCase(), c = q.get('category'), from = q.get('from'), to = q.get('to');
      let l = history.filter((h) => (!c || h.category === c) && (!f || (h.label + (h.animal?.name ?? '')).toLowerCase().includes(f)) && (!from || h.at.slice(0, 10) >= from) && (!to || h.at.slice(0, 10) <= to));
      l = q.get('order') === 'asc' ? l : [...l].reverse();
      return json(res, 200, { items: l, total: l.length, page: 1, limit: 30 });
    }
    let m0;
    if ((m0 = /^\/animals\/([^/]+)\/archive$/.exec(path))) {
      if (m0[1] !== FORMER_ID) return json(res, 404, { code: 'not_found', message: 'Animal introuvable.' });
      const { id, code, kind, species, name, breed, sex, bornOn, qtyInitial, rfid, createdAt } = former;
      return json(res, 200, { readOnly: true, cutoff: '2026-05-10', exit: { type: 'vente', on: '2026-05-10' }, animal: { id, code, kind, species, name, breed, sex, bornOn, qtyInitial, rfid, createdAt }, events: formerEvents, cases: [], flows: [{ id: 'ff1', type: 'vente', qty: null, counterpart: 'M. Diallo', note: null, occurredOn: '2026-05-10', recordedBy: { id: 'x', name: 'Awa Koné' }, createdAt: '2026-05-10T10:00:00Z' }] });
    }
    if (path === '/access') return json(res, 200, { items: [] });
    if (path === '/animals' && req.method === 'GET') {
      const all = q.get('scope') === 'all';
      let l = animals.filter((a) => (!q.get('status') || a.status === q.get('status')) && (!q.get('q') || (a.name + a.code).toLowerCase().includes(q.get('q').toLowerCase())) && (!q.get('species') || a.species === q.get('species')));
      if (q.get('sort') === 'name') l = [...l].sort((x, y) => x.name.localeCompare(y.name) * (q.get('order') === 'desc' ? -1 : 1));
      const items = l.map((a) => (all ? { ...card(a), relation: 'current', exit: null } : card(a)));
      if (all && (!q.get('q') || former.name.toLowerCase().includes(q.get('q').toLowerCase()))) items.push({ ...card(former), ownerId: undefined, owner: { id: '', name: 'Un autre éleveur' }, relation: 'former', exit: { type: 'vente', on: '2026-05-10' }, access: undefined });
      return json(res, 200, { items, total: items.length, page: 1, limit: 20 });
    }
    let m;
    if (path === '/export/history.csv') { res.writeHead(200, { 'content-type': 'text/csv' }); return res.end('date,evenement\n'); }
    if ((m = /^\/animals\/([^/]+)$/.exec(path))) { const a = animals.find((x) => x.id === m[1]); return a ? json(res, 200, card(a)) : json(res, 404, { code: 'not_found', message: 'Introuvable.' }); }
    if ((m = /^\/animals\/([^/]+)\/health-summary$/.exec(path))) { const w = events.filter((e) => e.animalId === m[1] && e.withdrawalUntil).map((e) => e.withdrawalUntil).sort().pop() ?? null; const act = w && w > new Date().toISOString().slice(0, 10); return json(res, 200, { withdrawalUntil: act ? w : null, canSell: !act, upcoming: [], lastEvent: events.filter((e) => e.animalId === m[1]).pop() ?? null }); }
    if ((m = /^\/animals\/([^/]+)\/health-events$/.exec(path))) { const f = (q.get('q') ?? '').toLowerCase(), t = q.get('type'); let l = events.filter((e) => e.animalId === m[1] && (!t || e.type === t) && (!f || e.label.toLowerCase().includes(f))); l = q.get('order') === 'asc' ? l : [...l].reverse(); return json(res, 200, { items: l }); }
    if ((m = /^\/animals\/([^/]+)\/cases$/.exec(path))) return json(res, 200, { items: cases.filter((c) => c.animalId === m[1]) });
    if ((m = /^\/animals\/([^/]+)\/flows$/.exec(path))) return json(res, 200, { items: flows.filter((f) => f.animalId === m[1]) });
    if ((m = /^\/animals\/([^/]+)\/access$/.exec(path))) return json(res, 200, { items: [] });
    if (path === '/vets/pending') return json(res, 200, { items: users.filter((x) => x.vet && !x.vet.verified).map((x) => ({ id: x.id, name: x.name, phone: x.phone, zone: 'Korhogo', clinic: null, orderNumber: x.vet.orderNumber, registeredAt: x.createdAt })) });
    if ((m = /^\/vets\/([^/]+)\/verify$/.exec(path))) { const x = users.find((y) => y.id === m[1]); x.vet.verified = true; return json(res, 200, { id: x.id, verified: true }); }
    if (path === '/stats/overview') return json(res, 200, { scope: 'national', periodDays: 30, animalsByStatus: [], activeBySpecies: [{ species: 'bovin', animals: animals.length, heads: animals.length }], topDiseases: [], openCases: cases.length, deaths: 0, unhandledAlerts: {}, vets: { total: 1, verified: 0 } });
    if (path === '/stats/health-map') return json(res, 200, { periodDays: 30, disease: q.get('disease') || null, items: [{ zone: { id: 'z1', name: 'Korhogo', lat: 9.46, lng: -5.63 }, cases: q.get('disease') === 'rage' ? 0 : 4, animals: 3, openCases: 2, deaths: 1 }, { zone: { id: 'z2', name: 'Abidjan', lat: 5.35, lng: -4.0 }, cases: q.get('disease') === 'rage' ? 0 : 1, animals: 1, openCases: 0, deaths: 0 }], diseases: [{ disease: 'fièvre aphteuse', cases: 4, notifiable: true }, { disease: 'rage', cases: 0, notifiable: true }] });
    if (path === '/stats/cases-timeline') return json(res, 200, { periodDays: 56, disease: null, zoneId: null, points: Array.from({ length: 8 }, (_, i) => ({ weekStart: `2026-0${(i % 9) + 1}-01`, cases: i % 3, deaths: 0 })) });
    if (path === '/audit') return json(res, 200, { items: [{ id: 1, at: '2026-11-18T10:00:00Z', action: 'auth.login', category: 'compte', label: 'Connexion', actor: { id: 'x', name: 'Awa Koné', role: 'eleveur' }, animal: null, detail: null }], total: 1, page: 1, limit: 30 });
    if (path === '/stats/zones') return json(res, 200, { items: [] });
    // --- achat : annonce à l'unité, négociation, profil acheteur ---
    const LID = '00000000-0000-4000-8000-0000000000bb';
    const L = (stats.lot ??= { id: LID, code: 'CI-VOL-77001', species: 'volaille', kind: 'lot', name: 'Poulets de chair', breed: null, sex: null, bornOn: null, qty: 150, avgWeightKg: null, price: 1500, bulkMinQty: 100, bulkPrice: 1200, listingQty: 120, listedAt: '2026-11-10T10:00:00Z', zone: 'Korhogo', ownerName: 'Awa Koné', photoUrl: null });
    const pr = (stats.reqs ??= []);
    const profiles = (stats.profiles ??= new Map());
    const notifs = (stats.notifs ??= []);
    const push = (userId, title, link) => notifs.push({ id: randomUUID(), userId, kind: 'x', title, body: null, link, read: false, createdAt: new Date().toISOString() });
    const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ') + ' FCFA';
    const unitsOf = (n) => `${n} ${n > 1 ? 'volailles' : 'volaille'}`;
    const tier = (qty) => (qty >= L.bulkMinQty ? L.bulkPrice : L.price);
    const reserved = (except) => pr.filter((r) => r.status === 'acceptee' && r.id !== except).reduce((s, r) => s + r.agreed.qty, 0);
    const avail = (except) => Math.max(0, L.listingQty - reserved(except));
    const live = () => L.listingQty > 0;
    const msg = (r, sender, kind, body, x = {}) => r.msgs.push({ id: randomUUID(), kind, body, senderId: sender?.id ?? null, senderName: sender?.name ?? null, qty: x.qty ?? null, unitPrice: x.unitPrice ?? null, total: x.total ?? null, createdAt: new Date().toISOString() });
    const prDto = (r, side) => {
      const shared = ['acceptee', 'conclue'].includes(r.status); const mine = side === 'buyer' ? r.b : r.s; const theirs = side === 'buyer' ? r.s : r.b; const pf = profiles.get(r.buyerId);
      return { id: r.id, status: r.status, message: r.message, qty: r.qty, offeredPrice: r.offeredPrice, agreedPrice: r.agreed?.unitPrice ?? null, agreedQty: r.agreed?.qty ?? null, agreedTotal: r.agreed ? r.agreed.qty * r.agreed.unitPrice : null,
        listingPrice: L.price, bulkMinQty: L.bulkMinQty, bulkPrice: L.bulkPrice, mine, theirs, sellerNote: null, createdAt: r.createdAt, decidedAt: null, completedAt: null,
        animal: { id: LID, code: L.code, name: L.name, species: 'volaille', kind: 'lot', qty: L.qty },
        other: side === 'buyer' ? { name: 'Awa Koné', phone: shared ? '0712345678' : null } : { name: r.buyerName, phone: shared ? r.buyerPhone : null },
        buyerProfile: side === 'seller' && pf ? { ...pf, contactPhone: shared ? pf.contactPhone ?? null : null } : null };
    };
    const agree = (r) => {
      const { qty, unitPrice } = r.b; r.status = 'acceptee'; r.agreed = { qty, unitPrice };
      msg(r, null, 'recap', `Accord conclu\nAnimal : ${L.name} (${L.code})\nQuantité : ${unitsOf(qty)}\nPrix à l'unité : ${fmt(unitPrice)}\nTotal : ${fmt(qty * unitPrice)}\nVous pouvez maintenant vous contacter pour convenir de la remise.`, { qty, unitPrice, total: qty * unitPrice });
      push(r.buyerId, 'Accord conclu : Poulets de chair', `/demandes?ouvrir=${r.id}`); push(users[0].id, 'Accord conclu : Poulets de chair', `/demandes?ouvrir=${r.id}`);
    };
    const side = (r, uu) => (r.buyerId === uu.id ? 'buyer' : 'seller');
    if (path === '/market') return json(res, 200, live() ? { items: [{ ...L, price: L.price }], total: 1, page: 1, limit: 20 } : { items: [], total: 0, page: 1, limit: 20 });
    if (path === `/market/${LID}` && req.method === 'GET') { const mine = pr.find((r) => r.buyerId === u?.id && ['en_attente', 'acceptee'].includes(r.status)); return json(res, 200, { ...L, availableQty: avail(), photos: [], health: { vaccines: [{ label: 'Newcastle', doneOn: '2026-10-01', signedByVet: true }], openCases: 0 }, isMine: false, myRequest: mine ? { id: mine.id, status: mine.status } : null }); }
    if (path === `/market/${LID}/requests` && req.method === 'POST') {
      const a = avail(); const qty = body.qty ?? a; if (qty > a) return json(res, 409, { code: 'qty_exceeds_available', message: `Il n'en reste que ${a} à vendre.` });
      const unit = body.offeredPrice ?? tier(qty);
      const r = { id: randomUUID(), status: 'en_attente', message: body.message ?? null, offeredPrice: body.offeredPrice ?? null, qty, b: { qty, unitPrice: unit }, s: null, agreed: null, msgs: [], createdAt: new Date().toISOString(), buyerId: u.id, buyerName: u.name, buyerPhone: u.phone };
      pr.push(r); if (body.message) msg(r, u, 'text', body.message); msg(r, u, 'proposal', `Je propose : ${unitsOf(qty)} à ${fmt(unit)} l'unité, soit ${fmt(unit * qty)}.`, { qty, unitPrice: unit, total: unit * qty });
      push(users[0].id, "Demande d'achat : Poulets de chair", `/demandes?ouvrir=${r.id}`); return json(res, 201, { id: r.id, status: r.status, qty, unitPrice: unit, total: unit * qty });
    }
    if (path === '/me/purchase-requests') { const l = pr.filter((r) => r.buyerId === u.id && (!q.get('status') || r.status === q.get('status'))); return json(res, 200, { items: l.map((r) => prDto(r, 'buyer')), total: l.length, page: 1, limit: 20 }); }
    if (path === '/purchase-requests') { const s = (q.get('q') ?? '').toLowerCase(); const l = pr.filter((r) => (!s || r.buyerName.toLowerCase().includes(s) || (profiles.get(r.buyerId)?.orgName ?? '').toLowerCase().includes(s)) && (!q.get('status') || r.status === q.get('status'))); return json(res, 200, { items: l.map((r) => prDto(r, 'seller')), total: l.length, page: 1, limit: 20 }); }
    if ((m = /^\/purchase-requests\/([^/]+)$/.exec(path)) && req.method === 'GET') { const r = pr.find((x) => x.id === m[1]); if (!r || ![r.buyerId, users[0].id].includes(u.id)) return json(res, 404, { code: 'not_found', message: 'Demande introuvable.' }); return json(res, 200, { ...prDto(r, side(r, u)), side: side(r, u), availableQty: r.status === 'en_attente' ? avail(r.id) : null }); }
    if ((m = /^\/purchase-requests\/([^/]+)\/messages$/.exec(path))) {
      const r = pr.find((x) => x.id === m[1]); if (!r) return json(res, 404, { code: 'not_found', message: 'Introuvable.' });
      if (req.method === 'POST') { if (!['en_attente', 'acceptee'].includes(r.status)) return json(res, 409, { code: 'request_closed', message: 'Conversation fermée.' }); msg(r, u, 'text', body.body); push(side(r, u) === 'buyer' ? users[0].id : r.buyerId, 'Message : Poulets de chair', `/demandes?ouvrir=${r.id}`); }
      return json(res, req.method === 'POST' ? 201 : 200, { items: r.msgs.map((x) => ({ ...x, mine: x.senderId === u.id })) });
    }
    if ((m = /^\/purchase-requests\/([^/]+)\/proposal$/.exec(path)) && req.method === 'POST') {
      const r = pr.find((x) => x.id === m[1]); if (r.status !== 'en_attente') return json(res, 409, { code: 'request_closed', message: "L'accord est déjà conclu." });
      if (body.qty > avail(r.id)) return json(res, 409, { code: 'qty_exceeds_available', message: `Il n'en reste que ${avail(r.id)} à vendre.` });
      const sd = side(r, u); r[sd === 'buyer' ? 'b' : 's'] = { qty: body.qty, unitPrice: body.unitPrice }; r.qty = body.qty;
      msg(r, u, 'proposal', `Proposition : ${unitsOf(body.qty)} à ${fmt(body.unitPrice)}`, { qty: body.qty, unitPrice: body.unitPrice, total: body.qty * body.unitPrice });
      const same = r.b && r.s && r.b.qty === r.s.qty && r.b.unitPrice === r.s.unitPrice; if (same) agree(r);
      return json(res, 200, { ...prDto(r, sd), side: sd, agreed: !!same });
    }
    if ((m = /^\/purchase-requests\/([^/]+)\/(accept|refuse|cancel|complete)$/.exec(path)) && req.method === 'POST') {
      const r = pr.find((x) => x.id === m[1]);
      if (m[2] === 'accept') { r.s = { ...r.b }; agree(r); }
      if (m[2] === 'refuse') { r.status = 'refusee'; msg(r, null, 'system', 'Demande refusée.'); }
      if (m[2] === 'cancel') { r.status = 'annulee'; msg(r, null, 'system', 'Demande retirée.'); }
      if (m[2] === 'complete') { const n = r.agreed.qty; r.status = 'conclue'; stats.sold = (stats.sold ?? 0) + n; L.qty -= n; L.listingQty = Math.max(0, L.listingQty - n); msg(r, null, 'system', `Vente enregistrée : ${unitsOf(n)} pour ${fmt(n * r.agreed.unitPrice)}.`); push(r.buyerId, 'Achat finalisé : Poulets de chair', '/animaux'); }
      return json(res, 200, { ...prDto(r, m[2] === 'cancel' ? 'buyer' : 'seller'), transferId: null, newAnimalId: m[2] === 'complete' ? randomUUID() : undefined });
    }
    if (path === '/me/buyer-profile') { if (req.method === 'PUT') { profiles.set(u.id, { profession: body.profession ?? null, orgKind: body.orgKind ?? null, orgName: body.orgName ?? null, contactName: body.contactName ?? null, contactPhone: body.contactPhone ?? null, locality: body.locality ?? null }); stats.lastProfile = body; } return json(res, 200, { profile: profiles.get(u.id) ?? null }); }
    if ((m = /^\/animals\/([^/]+)\/listing$/.exec(path)) && req.method === 'POST') { const a = animals.find((x) => x.id === m[1]); if (!a) return json(res, 404, { code: 'not_found', message: 'Introuvable.' }); stats.lastListing = body; a.listing = { price: body.price, qty: body.qty ?? 1, bulkMinQty: body.bulkMinQty ?? null, bulkPrice: body.bulkPrice ?? null, listedAt: new Date().toISOString() }; return json(res, 200, { animalId: a.id, listed: true, ...body }); }
    if (path === '/me/notifications' && req.method === 'GET') { const l = notifs.filter((n) => n.userId === u.id && (q.get('unread') !== 'true' || !n.read)); return json(res, 200, { items: l.slice(0, Number(q.get('limit') ?? 20)).map(({ userId, ...n }) => n), total: l.length, unread: notifs.filter((n) => n.userId === u.id && !n.read).length, page: 1, limit: 20 }); }
    if (path === '/me/notifications/read-all') { notifs.filter((n) => n.userId === u.id).forEach((n) => { n.read = true; }); return json(res, 200, { marked: 1 }); }
    if ((m = /^\/me\/notifications\/([^/]+)\/read$/.exec(path))) { const n = notifs.find((x) => x.id === m[1]); if (n) n.read = true; res.writeHead(204); return res.end(); }
    if ((m = /^\/animals\/([^/]+)\/photos\/upload$/.exec(path))) { stats.uploads = (stats.uploads ?? 0) + 1; stats.lastUploadBytes = (body.data ?? '').length; return json(res, 201, { id: randomUUID(), url: '/photos/x/file' }); }
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
  return { server: createServer(handler), stats, animals, cases };
}
