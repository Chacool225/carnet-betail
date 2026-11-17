import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'carnet-betail';
const AUDIENCE = 'carnet-betail-api';

export interface AccessClaims {
  sub: string;
  role: 'eleveur' | 'vet' | 'agent' | 'autorite';
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(secret: string, claims: AccessClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

/** Vérifie la signature, l'expiration, l'émetteur et le public. Lève une erreur si le jeton est invalide. */
export async function verifyAccessToken(secret: string, token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') throw new Error('claims invalides');
  return { sub: payload.sub, role: payload.role as AccessClaims['role'] };
}

/** Jeton de renouvellement : 32 octets aléatoires. Seul son empreinte SHA-256 est stockée en base. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
