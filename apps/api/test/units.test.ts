import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/lib/phone.js';
import { dummyVerify, hashSecret, verifySecret } from '../src/lib/passwords.js';
import { afterFailure, isLocked } from '../src/lib/lockout.js';
import { hashToken, newRefreshToken, signAccessToken, verifyAccessToken } from '../src/lib/tokens.js';
import { loadConfig } from '../src/config.js';

describe('normalizePhone', () => {
  it.each([
    ['07 12 34 56 78', '0712345678'],
    ['07.12.34.56.78', '0712345678'],
    ['07-12-34-56-78', '0712345678'],
    ['+225 07 12 34 56 78', '0712345678'],
    ['00225 0712345678', '0712345678'],
    ['2250712345678', '0712345678'],
  ])('%s -> %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(['', '123', '07123456789', 'abcdefghij'])('rejette %s', (v) => expect(normalizePhone(v)).toBeNull());
});

describe('mots de passe', () => {
  it('vérifie le bon secret et rejette le mauvais', async () => {
    const h = await hashSecret('secret-123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifySecret('secret-123', h)).toBe(true);
    expect(await verifySecret('autre', h)).toBe(false);
  });
  it('deux hachages du même secret diffèrent (sel)', async () => {
    expect(await hashSecret('x1234567')).not.toBe(await hashSecret('x1234567'));
  });
  it('rejette un format de hachage corrompu', async () => {
    expect(await verifySecret('x', 'nimporte quoi')).toBe(false);
  });
  it('dummyVerify ne lève pas', async () => {
    await expect(dummyVerify('x')).resolves.not.toThrow();
  });
});

describe('verrouillage', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  it('compte les échecs sans verrouiller avant le seuil', () => {
    expect(afterFailure(0, 5, 15, now)).toEqual({ failedAttempts: 1, lockedUntil: null });
  });
  it('verrouille au seuil', () => {
    const r = afterFailure(4, 5, 15, now);
    expect(r.failedAttempts).toBe(5);
    expect(r.lockedUntil?.toISOString()).toBe('2026-11-20T10:15:00.000Z');
  });
  it('isLocked', () => {
    expect(isLocked(new Date('2026-11-20T10:15:00Z'), now)).toBe(true);
    expect(isLocked(new Date('2026-11-20T09:59:00Z'), now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });
});

describe('jetons', () => {
  const secret = 'x'.repeat(40);
  it('signe et vérifie un jeton d’accès', async () => {
    const t = await signAccessToken(secret, { sub: 'u1', role: 'vet' }, 60);
    expect(await verifyAccessToken(secret, t)).toEqual({ sub: 'u1', role: 'vet' });
  });
  it('rejette un mauvais secret', async () => {
    const t = await signAccessToken(secret, { sub: 'u1', role: 'vet' }, 60);
    await expect(verifyAccessToken('y'.repeat(40), t)).rejects.toThrow();
  });
  it('rejette un jeton expiré', async () => {
    const t = await signAccessToken(secret, { sub: 'u1', role: 'vet' }, -10);
    await expect(verifyAccessToken(secret, t)).rejects.toThrow();
  });
  it('le jeton de renouvellement est haché de façon stable', () => {
    const r = newRefreshToken();
    expect(hashToken(r.token)).toBe(r.hash);
    expect(r.token.length).toBeGreaterThan(30);
  });
});

describe('configuration', () => {
  it('exige un JWT_SECRET long', () => {
    expect(() => loadConfig({ JWT_SECRET: 'court' })).toThrow(/JWT_SECRET/);
  });
  it('exige DATABASE_URL en production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) })).toThrow(/DATABASE_URL/);
  });
  it('valeurs par défaut', () => {
    const c = loadConfig({ JWT_SECRET: 'x'.repeat(40) });
    expect(c.accessTtlSeconds).toBe(900);
    expect(c.loginMaxAttempts).toBe(5);
    expect(c.rateLimitEnabled).toBe(true);
  });
});

import { isNotifiable } from '../src/lib/diseases.js';
describe('maladies à déclaration obligatoire', () => {
  it.each(['Grippe aviaire', 'FIEVRE APHTEUSE', 'fièvre aphteuse', 'Newcastle', 'PPR', 'Rage', 'Brucellose'])('%s est notifiable', (d) => expect(isNotifiable(d)).toBe(true));
  it.each(['Diarrhée', 'Mammite', 'Courage', 'Toux'])('%s ne l’est pas', (d) => expect(isNotifiable(d)).toBe(false));
});
