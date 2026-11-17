export interface LockState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

/** Calcule l'état du compte après un échec de connexion. Verrouille à partir de `max` échecs. */
export function afterFailure(attempts: number, max: number, lockMinutes: number, now: Date): LockState {
  const failedAttempts = attempts + 1;
  const lockedUntil = failedAttempts >= max ? new Date(now.getTime() + lockMinutes * 60_000) : null;
  return { failedAttempts, lockedUntil };
}

/** Un verrouillage expiré remet le compteur à zéro. */
export function isLocked(lockedUntil: Date | null | undefined, now: Date): boolean {
  return !!lockedUntil && lockedUntil.getTime() > now.getTime();
}
