import type { AuthResult, OpType, SyncResult } from './types';

declare const __API_URL__: string;
export const BASE: string = typeof __API_URL__ === 'string' ? __API_URL__ : '/api';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}
/** La requête n'a pas atteint le serveur (hors-ligne, coupure). */
export class NetworkError extends Error {
  constructor() { super('Pas de connexion au serveur.'); }
}

const RT_KEY = 'carnet.refresh';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
export { store };

let access: string | null = null;
let onSessionLost: () => void = () => {};
export const setSessionLostHandler = (fn: () => void) => { onSessionLost = fn; };

export const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });

export function setSession(r: Pick<AuthResult, 'accessToken' | 'refreshToken'>): void {
  access = r.accessToken;
  store.set(RT_KEY, r.refreshToken);
}
export function clearSession(): void {
  access = null;
  store.del(RT_KEY);
}
export const hasStoredSession = (): boolean => !!store.get(RT_KEY);
export const getRefreshToken = (): string | null => store.get(RT_KEY);

async function send(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean }): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth !== false && access) headers.authorization = `Bearer ${access}`;
  try {
    return await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new NetworkError();
  }
}

let refreshing: Promise<boolean> | null = null;
/**
 * Renouvelle les jetons. Un seul renouvellement à la fois, même avec plusieurs onglets : le jeton de renouvellement
 * ne sert qu'une fois côté serveur, deux renouvellements simultanés fermeraient la session.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  const run = async (): Promise<boolean> => {
    const rt = store.get(RT_KEY);
    if (!rt) return false;
    let res: Response;
    try {
      res = await send('POST', '/auth/refresh', { body: { refreshToken: rt }, auth: false });
    } catch {
      return false; // hors-ligne : on garde la session, on réessaiera
    }
    if (!res.ok) {
      if (res.status === 401) { clearSession(); onSessionLost(); }
      return false;
    }
    setSession((await res.json()) as AuthResult);
    return true;
  };
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  refreshing = (locks ? (locks.request('carnet-refresh', run) as Promise<boolean>) : run()).finally(() => { refreshing = null; });
  return refreshing;
}

async function parse(res: Response): Promise<any> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

export async function request<T = any>(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean; idempotent?: boolean } = {}): Promise<T> {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.idempotent && method !== 'GET' && !headers['idempotency-key']) headers['idempotency-key'] = uuid();
  let res = await send(method, path, { ...opts, headers });
  if (res.status === 401 && opts.auth !== false) {
    const code = (await res.clone().json().catch(() => null))?.code;
    if ((code === 'invalid_token' || code === 'unauthorized') && (await refreshSession())) res = await send(method, path, { ...opts, headers });
  }
  const data = await parse(res);
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? `Erreur ${res.status}`, data?.details);
  }
  return data as T;
}

// ---- lecture avec copie locale : l'écran reste utilisable sans réseau ----
export interface Cached<T> { data: T; savedAt: string; stale: boolean }
const CACHE_PREFIX = 'carnet.cache.';

export async function cachedGet<T>(path: string, scope: string): Promise<Cached<T>> {
  const key = `${CACHE_PREFIX}${scope}.${path}`;
  try {
    const data = await request<T>('GET', path);
    const savedAt = new Date().toISOString();
    store.set(key, JSON.stringify({ data, savedAt }));
    return { data, savedAt, stale: false };
  } catch (e) {
    if (e instanceof NetworkError) {
      const raw = store.get(key);
      if (raw) { const { data, savedAt } = JSON.parse(raw); return { data, savedAt, stale: true }; }
    }
    throw e;
  }
}
/** Efface les copies locales (déconnexion : elles contiennent des données de l'utilisateur). */
export function clearCache(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX) || k === 'carnet.queue') localStorage.removeItem(k);
  } catch { /* rien */ }
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {}, idempotent: true }),
  patch: <T = any>(path: string, body: unknown) => request<T>('PATCH', path, { body, idempotent: true }),
  del: <T = any>(path: string) => request<T>('DELETE', path, { idempotent: true }),
};

export const qs = (o: Record<string, string | number | boolean | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export async function downloadCsv(path: string, filename: string): Promise<void> {
  const res = await send('GET', path, {});
  if (!res.ok) throw new ApiError(res.status, 'export_failed', "L'export a échoué.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type { OpType, SyncResult };
