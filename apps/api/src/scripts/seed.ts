import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { createDb, type Queryable } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { hashSecret } from '../lib/passwords.js';

/** Données de démonstration (fictives). Rejouable sans doublon : tout est identifié par des UUID fixes. */
export const DEMO_PASSWORD = 'Demo1234!';

export const ZONES = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Abidjan', lat: 5.36, lng: -4.01 },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Bouaké', lat: 7.69, lng: -5.03 },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Korhogo', lat: 9.46, lng: -5.63 },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Ferkessédougou', lat: 9.59, lng: -5.2 },
  { id: '00000000-0000-4000-8000-000000000005', name: 'Yamoussoukro', lat: 6.82, lng: -5.28 },
  { id: '00000000-0000-4000-8000-000000000006', name: 'Daloa', lat: 6.88, lng: -6.45 },
  { id: '00000000-0000-4000-8000-000000000007', name: 'Man', lat: 7.41, lng: -7.55 },
  { id: '00000000-0000-4000-8000-000000000008', name: 'San-Pédro', lat: 4.75, lng: -6.64 },
];

export const DEMO_USERS = [
  { id: '00000000-0000-4000-8000-0000000000a1', role: 'eleveur', name: 'Awa Koné', phone: '0712345678', email: 'awa@demo.ci', pin: '1234', zone: ZONES[2]!.id },
  { id: '00000000-0000-4000-8000-0000000000a2', role: 'eleveur', name: 'Seydou Traoré', phone: '0723456789', email: null, pin: '4321', zone: ZONES[3]!.id },
  { id: '00000000-0000-4000-8000-0000000000b1', role: 'vet', name: 'Dr Yao Kouadio', phone: '0501020304', email: 'yao@demo.ci', pin: null, zone: ZONES[0]!.id },
  { id: '00000000-0000-4000-8000-0000000000c1', role: 'agent', name: 'Agent Bamba', phone: '0102030405', email: 'agent@demo.ci', pin: null, zone: ZONES[3]!.id },
  { id: '00000000-0000-4000-8000-0000000000d1', role: 'autorite', name: 'Direction des services vétérinaires', phone: '0505050505', email: 'autorite@demo.ci', pin: null, zone: ZONES[0]!.id },
] as const;

export const DEMO_ANIMALS = [
  { id: '00000000-0000-4000-8000-0000000001a1', code: 'CI-BOV-00431', kind: 'individual', species: 'bovin', name: 'Kouadio', breed: 'N\'Dama', sex: 'M', bornOn: '2023-03-14', owner: '00000000-0000-4000-8000-0000000000a2', zone: ZONES[3]!.id, qty: null, rfid: '0A1B2C3D4E5F' },
  { id: '00000000-0000-4000-8000-0000000001a2', code: 'CI-BOV-00432', kind: 'individual', species: 'bovin', name: 'Tacheté', breed: 'Zébu', sex: 'F', bornOn: '2022-08-02', owner: '00000000-0000-4000-8000-0000000000a1', zone: ZONES[2]!.id, qty: null, rfid: null },
  { id: '00000000-0000-4000-8000-0000000001a3', code: 'CI-VOL-00101', kind: 'lot', species: 'volaille', name: 'Poulets de chair — bande 1', breed: null, sex: null, bornOn: null, owner: '00000000-0000-4000-8000-0000000000a1', zone: ZONES[2]!.id, qty: 150, rfid: null },
] as const;

export async function seed(q: Queryable): Promise<void> {
  for (const z of ZONES) {
    await q.query('INSERT INTO zones (id, name, lat, lng) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [z.id, z.name, z.lat, z.lng]);
  }
  const pwd = await hashSecret(DEMO_PASSWORD);
  for (const u of DEMO_USERS) {
    const pin = u.pin ? await hashSecret(u.pin) : null;
    await q.query(
      `INSERT INTO users (id, role, name, phone, email, password_hash, pin_hash, zone_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [u.id, u.role, u.name, u.phone, u.email, pwd, pin, u.zone],
    );
  }
  await q.query(
    `INSERT INTO vets (user_id, order_number, clinic, verified) VALUES ($1,'ONV-CI-0042','Clinique vétérinaire du Plateau', true)
     ON CONFLICT (user_id) DO NOTHING`,
    ['00000000-0000-4000-8000-0000000000b1'],
  );
  for (const a of DEMO_ANIMALS) {
    await q.query(
      `INSERT INTO animals (id, public_code, kind, species, breed, name, sex, born_on, owner_id, zone_id, qty, qty_initial, rfid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12) ON CONFLICT DO NOTHING`,
      [a.id, a.code, a.kind, a.species, a.breed, a.name, a.sex, a.bornOn, a.owner, a.zone, a.qty, a.rfid],
    );
  }
  // Le vétérinaire de démonstration a un accès en cours sur le bovin de Seydou (renouvelé par scan ou soin, RG1).
  await q.query(
    `INSERT INTO access_grants (animal_id, vet_id, source, expires_on)
     SELECT $1, $2, 'scan', current_date + 30
     WHERE NOT EXISTS (SELECT 1 FROM access_grants WHERE animal_id = $1 AND vet_id = $2 AND revoked_on IS NULL)`,
    ['00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000000b1'],
  );
  await q.query(
    `INSERT INTO health_events (id, animal_id, type, label, done_on, next_due_on, vet_id, recorded_by, note)
     VALUES ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000001a1', 'vaccin', 'Charbon symptomatique',
             '2026-10-01', '2027-04-01', $1, $1, 'Rappel dans six mois')
     ON CONFLICT DO NOTHING`,
    ['00000000-0000-4000-8000-0000000000b1'],
  );
}

// Exécution directe : `pnpm seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const db = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
  await migrate(db);
  await db.tx((q) => seed(q));
  console.log(`Données de démonstration prêtes. Mot de passe de tous les comptes : ${DEMO_PASSWORD}`);
  await db.close();
}
