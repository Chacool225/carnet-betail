import type { Queryable } from '../../db/index.js';
import { forbidden } from '../../lib/errors.js';
import { iso } from '../../lib/audit.js';
import type { AuthContext } from '../../plugins/auth.js';
import type { BuyerProfileBody } from './schemas.js';

export async function getBuyerProfile(q: Queryable, userId: string) {
  const r = (await q.query('SELECT * FROM buyer_profiles WHERE user_id = $1', [userId]))[0];
  if (!r) return null;
  return {
    profession: (r.profession ?? null) as string | null, orgKind: (r.org_kind ?? null) as string | null, orgName: (r.org_name ?? null) as string | null,
    contactName: (r.contact_name ?? null) as string | null, contactPhone: (r.contact_phone ?? null) as string | null,
    locality: (r.locality ?? null) as string | null, updatedAt: iso(r.updated_at),
  };
}

export async function saveBuyerProfile(q: Queryable, userId: string, b: BuyerProfileBody): Promise<void> {
  await q.query(
    `INSERT INTO buyer_profiles (user_id, profession, org_kind, org_name, contact_name, contact_phone, locality)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET profession = $2, org_kind = $3, org_name = $4, contact_name = $5, contact_phone = $6, locality = $7, updated_at = now()`,
    [userId, b.profession ?? null, b.orgKind ?? null, b.orgName ?? null, b.contactName ?? null, b.contactPhone ?? null, b.locality ?? null],
  );
}

export async function putBuyerProfile(q: Queryable, auth: AuthContext, b: BuyerProfileBody) {
  if (auth.role !== 'particulier') throw forbidden('Le profil acheteur est réservé aux particuliers.');
  await saveBuyerProfile(q, auth.userId, b);
  return getBuyerProfile(q, auth.userId);
}
