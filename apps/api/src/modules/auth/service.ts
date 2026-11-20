import { randomInt } from 'node:crypto';
import { saveBuyerProfile } from '../buyers/service.js';
import type { Config } from '../../config.js';
import { sendSms } from '../../lib/sms.js';
import type { Db, Queryable, Row } from '../../db/index.js';
import { AppError, conflict, invalid, notFound, tooMany, unauthorized } from '../../lib/errors.js';
import { afterFailure, isLocked } from '../../lib/lockout.js';
import { dummyVerify, hashSecret, verifySecret } from '../../lib/passwords.js';
import { normalizePhone } from '../../lib/phone.js';
import { hashToken, newRefreshToken, signAccessToken } from '../../lib/tokens.js';
import { iso, writeAudit } from '../../lib/audit.js';
import type { LoginBody, PinLoginBody, RegisterBody, UpdateMeBody } from './schemas.js';

export interface PublicUser {
  id: string;
  role: 'eleveur' | 'vet' | 'agent' | 'autorite' | 'particulier';
  name: string;
  phone: string;
  email: string | null;
  zone: { id: string; name: string } | null;
  photoUrl: string | null;
  vet: { orderNumber: string; clinic: string | null; verified: boolean } | null;
  prefs: Record<string, unknown>;
  createdAt: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: PublicUser;
}

const USER_SELECT = `
  SELECT u.*, z.name AS zone_name, v.order_number, v.clinic, v.verified
  FROM users u
  LEFT JOIN zones z ON z.id = u.zone_id
  LEFT JOIN vets v ON v.user_id = u.id`;

export function toPublicUser(r: Row): PublicUser {
  return {
    id: r.id,
    role: r.role,
    name: r.name,
    phone: r.phone,
    email: r.email ?? null,
    zone: r.zone_id ? { id: r.zone_id, name: r.zone_name } : null,
    photoUrl: r.photo_url ?? null,
    vet: r.order_number ? { orderNumber: r.order_number, clinic: r.clinic ?? null, verified: !!r.verified } : null,
    prefs: r.prefs ?? {},
    createdAt: iso(r.created_at),
  };
}

export async function getUserRow(q: Queryable, id: string): Promise<Row | undefined> {
  return (await q.query(`${USER_SELECT} WHERE u.id = $1`, [id]))[0];
}

const invalidCredentials = () => unauthorized('Identifiants incorrects.', 'invalid_credentials');

/** Crée le jeton d'accès et le jeton de renouvellement d'un utilisateur. `family` relie les renouvellements successifs. */
async function issueTokens(
  q: Queryable,
  cfg: Config,
  userRow: Row,
  meta: { userAgent?: string; family?: string },
): Promise<AuthResult> {
  const accessToken = await signAccessToken(cfg.jwtSecret, { sub: userRow.id, role: userRow.role }, cfg.accessTtlSeconds);
  const rt = newRefreshToken();
  const expires = new Date(Date.now() + cfg.refreshTtlDays * 86_400_000);
  const family = meta.family ?? (await q.query<{ id: string }>('SELECT gen_random_uuid() AS id'))[0]!.id;
  const inserted = await q.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userRow.id, rt.hash, family, expires.toISOString(), meta.userAgent?.slice(0, 200) ?? null],
  );
  void inserted;
  return { accessToken, refreshToken: rt.token, tokenType: 'Bearer', expiresIn: cfg.accessTtlSeconds, user: toPublicUser(userRow) };
}

export async function register(db: Db, cfg: Config, body: RegisterBody, userAgent?: string): Promise<AuthResult> {
  return db.tx(async (q) => {
    if (body.zoneId) {
      const z = await q.query('SELECT 1 FROM zones WHERE id = $1', [body.zoneId]);
      if (!z.length) throw invalid('Zone inconnue.', [{ path: ['zoneId'], message: 'Zone inconnue.' }]);
    }
    const dup = await q.query('SELECT phone, email FROM users WHERE phone = $1 OR ($2::text IS NOT NULL AND email = $2)', [
      body.phone,
      body.email ?? null,
    ]);
    if (dup.length) {
      if (dup.some((d) => d.phone === body.phone)) throw conflict('phone_taken', 'Ce numéro de téléphone a déjà un compte.');
      throw conflict('email_taken', 'Cette adresse e-mail a déjà un compte.');
    }
    const passwordHash = await hashSecret(body.password);
    const pinHash = body.pin ? await hashSecret(body.pin) : null;
    const created = await q.query<{ id: string }>(
      `INSERT INTO users (role, name, phone, email, password_hash, pin_hash, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [body.role, body.name, body.phone, body.email ?? null, passwordHash, pinHash, body.zoneId ?? null],
    );
    const id = created[0]!.id;
    if (body.role === 'vet') {
      try {
        await q.query('INSERT INTO vets (user_id, order_number, clinic) VALUES ($1, $2, $3)', [id, body.orderNumber, body.clinic ?? null]);
      } catch (e: any) {
        if (e?.code === '23505') throw conflict('order_number_taken', "Ce numéro d'ordre est déjà utilisé.");
        throw e;
      }
    }
    if (body.buyerProfile) await saveBuyerProfile(q, id, body.buyerProfile);
    await writeAudit(q, { actorId: id, action: 'auth.register', detail: { role: body.role } });
    const row = (await getUserRow(q, id))!;
    return issueTokens(q, cfg, row, { userAgent });
  });
}

/** Cherche un compte par e-mail ou par téléphone. */
async function findByIdentifier(q: Queryable, identifier: string): Promise<Row | undefined> {
  if (identifier.includes('@')) return (await q.query(`${USER_SELECT} WHERE u.email = $1`, [identifier.toLowerCase()]))[0];
  const phone = normalizePhone(identifier);
  if (!phone) return undefined;
  return (await q.query(`${USER_SELECT} WHERE u.phone = $1`, [phone]))[0];
}

/**
 * Vérifie un secret (mot de passe ou PIN) avec compteur d'échecs et verrouillage temporaire.
 * Renvoie le compte si le secret est bon, sinon lève une erreur générique (on ne dit pas si le compte existe).
 */
async function checkSecret(
  db: Db,
  cfg: Config,
  row: Row | undefined,
  secret: string,
  storedHash: (r: Row) => string | null,
): Promise<Row> {
  if (!row || !storedHash(row)) {
    await dummyVerify(secret);
    throw invalidCredentials();
  }
  const now = new Date();
  let attempts: number = row.failed_attempts;
  let lockedUntil: Date | null = row.locked_until ? new Date(row.locked_until) : null;
  if (isLocked(lockedUntil, now)) {
    const retry = Math.ceil((lockedUntil!.getTime() - now.getTime()) / 1000);
    throw tooMany('Trop de tentatives. Réessayez plus tard.', { retryAfterSeconds: retry }, 'account_locked');
  }
  if (lockedUntil) {
    // le verrouillage a expiré : on repart de zéro
    attempts = 0;
    lockedUntil = null;
  }
  const ok = await verifySecret(secret, storedHash(row)!);
  if (!ok) {
    const next = afterFailure(attempts, cfg.loginMaxAttempts, cfg.lockMinutes, now);
    await db.tx(async (q) => {
      await q.query('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [
        row.id,
        next.failedAttempts,
        next.lockedUntil ? next.lockedUntil.toISOString() : null,
      ]);
      if (next.lockedUntil) await writeAudit(q, { actorId: row.id, action: 'auth.locked', detail: { minutes: cfg.lockMinutes } });
    });
    throw invalidCredentials();
  }
  if (attempts !== 0 || row.locked_until) {
    await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [row.id]);
  }
  return row;
}

export async function login(db: Db, cfg: Config, body: LoginBody, userAgent?: string): Promise<AuthResult> {
  const row = await findByIdentifier(db, body.identifier);
  const ok = await checkSecret(db, cfg, row, body.password, (r) => r.password_hash);
  return db.tx(async (q) => {
    const result = await issueTokens(q, cfg, ok, { userAgent });
    await writeAudit(q, { actorId: ok.id, action: 'auth.login', detail: { method: 'password', device: userAgent?.slice(0, 120) ?? null } });
    return result;
  });
}

/** Connexion du mode simple : visage (identifiant du compte, mémorisé sur le téléphone) ou téléphone, plus code à 4 chiffres. */
export async function pinLogin(db: Db, cfg: Config, body: PinLoginBody, userAgent?: string): Promise<AuthResult> {
  const row = body.userId
    ? (await db.query(`${USER_SELECT} WHERE u.id = $1`, [body.userId]))[0]
    : (await db.query(`${USER_SELECT} WHERE u.phone = $1`, [body.phone]))[0];
  // Le mode simple est réservé aux éleveurs.
  const usable = row && row.role === 'eleveur' ? row : undefined;
  const ok = await checkSecret(db, cfg, usable, body.pin, (r) => r.pin_hash);
  return db.tx(async (q) => {
    const result = await issueTokens(q, cfg, ok, { userAgent });
    await writeAudit(q, { actorId: ok.id, action: 'auth.login', detail: { method: 'pin', device: userAgent?.slice(0, 120) ?? null } });
    return result;
  });
}

/** Renouvelle les jetons. Chaque jeton de renouvellement ne sert qu'une fois ; le réutiliser révoque toute la famille. */
export async function refresh(db: Db, cfg: Config, refreshToken: string, userAgent?: string): Promise<AuthResult> {
  const outcome = await db.tx(async (q) => {
    const rows = await q.query('SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [hashToken(refreshToken)]);
    const t = rows[0];
    if (!t) return { error: 'invalid' as const };
    if (t.revoked_at) {
      await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family = $1 AND revoked_at IS NULL', [t.family]);
      return { error: 'reuse' as const };
    }
    if (new Date(t.expires_at).getTime() <= Date.now()) return { error: 'invalid' as const };
    const user = await getUserRow(q, t.user_id);
    if (!user) return { error: 'invalid' as const };
    await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [t.id]);
    const result = await issueTokens(q, cfg, user, { userAgent, family: t.family });
    const next = await q.query<{ id: string }>('SELECT id FROM refresh_tokens WHERE token_hash = $1', [hashToken(result.refreshToken)]);
    await q.query('UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1', [t.id, next[0]!.id]);
    return { result };
  });
  if (outcome.result) return outcome.result;
  if (outcome.error === 'reuse') {
    throw unauthorized('Session révoquée : ce jeton a déjà été utilisé. Reconnectez-vous.', 'refresh_reuse');
  }
  throw unauthorized('Jeton de renouvellement invalide ou expiré.', 'invalid_refresh');
}

/** Ferme la session : révoque la famille du jeton. Sans erreur si le jeton est inconnu (appel répétable). */
export async function logout(db: Db, refreshToken: string): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE revoked_at IS NULL AND family IN (SELECT family FROM refresh_tokens WHERE token_hash = $1)`,
    [hashToken(refreshToken)],
  );
}

export async function getMe(db: Db, id: string): Promise<PublicUser> {
  const row = await getUserRow(db, id);
  if (!row) throw notFound('Compte introuvable.');
  return toPublicUser(row);
}

export async function updateMe(db: Db, id: string, body: UpdateMeBody): Promise<PublicUser> {
  return db.tx(async (q) => {
    if (body.zoneId) {
      const z = await q.query('SELECT 1 FROM zones WHERE id = $1', [body.zoneId]);
      if (!z.length) throw invalid('Zone inconnue.', [{ path: ['zoneId'], message: 'Zone inconnue.' }]);
    }
    if (body.phone) {
      const d = await q.query('SELECT 1 FROM users WHERE phone = $1 AND id <> $2', [body.phone, id]);
      if (d.length) throw conflict('phone_taken', 'Ce numéro de téléphone a déjà un compte.');
    }
    if (body.email) {
      const d = await q.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [body.email, id]);
      if (d.length) throw conflict('email_taken', 'Cette adresse e-mail a déjà un compte.');
    }
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (body.name !== undefined) add('name', body.name);
    if (body.phone !== undefined) add('phone', body.phone);
    if (body.email !== undefined) add('email', body.email);
    if (body.zoneId !== undefined) add('zone_id', body.zoneId);
    if (body.prefs !== undefined) add('prefs', JSON.stringify(body.prefs));
    await q.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    return toPublicUser((await getUserRow(q, id))!);
  });
}

export async function changePassword(db: Db, cfg: Config, id: string, current: string, next: string): Promise<void> {
  const row = await getUserRow(db, id);
  if (!row) throw notFound('Compte introuvable.');
  await checkSecret(db, cfg, row, current, (r) => r.password_hash);
  const hash = await hashSecret(next);
  await db.tx(async (q) => {
    await q.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [id, hash]);
    // toutes les sessions existantes sont fermées
    await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await writeAudit(q, { actorId: id, action: 'auth.password_changed' });
  });
}

export async function setPin(db: Db, cfg: Config, id: string, password: string, pin: string): Promise<void> {
  const row = await getUserRow(db, id);
  if (!row) throw notFound('Compte introuvable.');
  if (row.role !== 'eleveur') throw new AppError(403, 'forbidden', 'Le code à 4 chiffres est réservé aux éleveurs (mode simple).');
  await checkSecret(db, cfg, row, password, (r) => r.password_hash);
  const hash = await hashSecret(pin);
  await db.tx(async (q) => {
    await q.query('UPDATE users SET pin_hash = $2, updated_at = now() WHERE id = $1', [id, hash]);
    await writeAudit(q, { actorId: id, action: 'auth.pin_changed' });
  });
}

// ---------- Mot de passe oublié ----------
const RESET_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;

/** Envoie un code à 6 chiffres. Silencieux si le numéro est inconnu, et au plus un code par minute et par compte. */
export async function forgotPassword(db: Db, cfg: Config, phoneRaw: string, log: (m: string) => void): Promise<void> {
  const phone = normalizePhone(phoneRaw);
  const row = (await db.query('SELECT id, phone FROM users WHERE phone = $1', [phone]))[0];
  if (!row) { await dummyVerify('000000'); return; }
  const recent = await db.query("SELECT 1 FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '60 seconds'", [row.id]);
  if (recent.length) return;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const hash = await hashSecret(code);
  await db.tx(async (q) => {
    await q.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [row.id]);
    await q.query(`INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, $2, now() + interval '${RESET_MINUTES} minutes')`, [row.id, hash]);
    await writeAudit(q, { actorId: row.id, action: 'auth.password_reset_requested' });
  });
  try {
    await sendSms(cfg.smsWebhookUrl, row.phone as string, `Carnet Bétail : votre code est ${code}. Il est valable ${RESET_MINUTES} minutes. Ne le donnez à personne.`, log);
  } catch (e) { log(`envoi du code impossible : ${String(e)}`); }
}

export async function resetPassword(db: Db, phoneRaw: string, code: string, newPassword: string): Promise<void> {
  const bad = () => invalid('Code incorrect ou expiré.', [{ path: ['code'], message: 'Code incorrect ou expiré.' }]);
  const phone = normalizePhone(phoneRaw);
  const user = (await db.query('SELECT id FROM users WHERE phone = $1', [phone]))[0];
  const r = user ? (await db.query('SELECT * FROM password_resets WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1', [user.id]))[0] : undefined;
  if (!user || !r) { await dummyVerify(code); throw bad(); }
  if ((r.attempts as number) >= RESET_MAX_ATTEMPTS) throw bad();
  if (!(await verifySecret(code, r.code_hash as string))) {
    await db.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [r.id]);
    throw bad();
  }
  const hash = await hashSecret(newPassword);
  await db.tx(async (q) => {
    await q.query('UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [user.id, hash]);
    await q.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
    await writeAudit(q, { actorId: user.id as string, action: 'auth.password_reset' });
  });
}
