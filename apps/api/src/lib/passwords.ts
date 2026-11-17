import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/**
 * Hachage des mots de passe et des codes PIN avec scrypt (intégré à Node, aucune dépendance native).
 * Format stocké : scrypt$N$r$p$sel(base64)$hash(base64)
 * Un code PIN à 4 chiffres n'a que 10 000 valeurs : la protection vient du verrouillage après échecs
 * (voir auth/service.ts), pas du hachage.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

function derive(secret: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(secret.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, 'base64');
  const key = await derive(secret, Buffer.from(saltB64!, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummy: Promise<string> | undefined;
/** Fait le même travail qu'une vraie vérification quand le compte n'existe pas (évite de révéler quels comptes existent). */
export async function dummyVerify(secret: string): Promise<void> {
  dummy ??= hashSecret('dummy-secret-for-timing');
  await verifySecret(secret, await dummy);
}
