import { ApiError, NetworkError, api, store, uuid } from './client';
import type { OpType, SyncResult } from './types';

/**
 * File d'attente hors-ligne (RG9). Toute écriture « métier » passe par POST /sync avec un clientId :
 * - en ligne, le résultat est immédiat ;
 * - hors-ligne, ou si la réponse se perd, la même opération (même clientId) part dans la file et sera rejouée sans doublon.
 */
export interface QueuedOp {
  clientId: string; type: OpType; payload: Record<string, unknown>; label: string; createdAt: string;
  status: 'pending' | 'rejected'; error?: { code: string; message: string };
}
const KEY = 'carnet.queue';
const EVT = 'carnet:queue';

const read = (): QueuedOp[] => { try { return JSON.parse(store.get(KEY) ?? '[]'); } catch { return []; } };
const write = (q: QueuedOp[]) => { store.set(KEY, JSON.stringify(q)); window.dispatchEvent(new Event(EVT)); };

export const queue = {
  list: read,
  pending: () => read().filter((o) => o.status === 'pending'),
  rejected: () => read().filter((o) => o.status === 'rejected'),
  remove(clientId: string) { write(read().filter((o) => o.clientId !== clientId)); },
  clearRejected() { write(read().filter((o) => o.status !== 'rejected')); },
  subscribe(fn: () => void) { window.addEventListener(EVT, fn); window.addEventListener('storage', fn); return () => { window.removeEventListener(EVT, fn); window.removeEventListener('storage', fn); }; },
};

export interface SubmitOutcome { queued: boolean; result?: Record<string, any> }

/** Envoie une opération ; renvoie `queued: true` si elle est partie dans la file (pas de réseau). Lève ApiError si le serveur la refuse. */
export async function submitOp(type: OpType, payload: Record<string, unknown>, label: string): Promise<SubmitOutcome> {
  const op: QueuedOp = { clientId: uuid(), type, payload, label, createdAt: new Date().toISOString(), status: 'pending' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { write([...read(), op]); return { queued: true }; }
  try {
    const { results } = await api.post<{ results: SyncResult[] }>('/sync', { ops: [{ clientId: op.clientId, type, payload }] });
    const r = results[0]!;
    if (r.status === 'ok') return { queued: false, result: r.result };
    throw new ApiError(r.error!.status, r.error!.code, r.error!.message, r.error!.details);
  } catch (e) {
    if (e instanceof NetworkError) { write([...read(), op]); return { queued: true }; }
    throw e;
  }
}

let flushing: Promise<{ sent: number; rejected: number }> | null = null;

/** Envoie la file par paquets de 100. Les refus définitifs (4xx) passent en « rejetées » ; les erreurs réseau ou 5xx laissent tout en attente. */
export function flushQueue(): Promise<{ sent: number; rejected: number }> {
  if (flushing) return flushing;
  const run = async () => {
    let sent = 0, rejected = 0;
    for (;;) {
      const batch = read().filter((o) => o.status === 'pending').slice(0, 100);
      if (!batch.length) break;
      let results: SyncResult[];
      try {
        ({ results } = await api.post<{ results: SyncResult[] }>('/sync', { ops: batch.map(({ clientId, type, payload }) => ({ clientId, type, payload })) }));
      } catch { break; } // réseau ou serveur : on réessaiera
      const byId = new Map(results.map((r) => [r.clientId, r]));
      let progressed = false;
      const next = read().flatMap((o): QueuedOp[] => {
        const r = byId.get(o.clientId);
        if (!r) return [o];
        if (r.status === 'ok') { sent++; progressed = true; return []; }
        if (r.error!.status >= 500) return [o];
        rejected++; progressed = true;
        return [{ ...o, status: 'rejected', error: { code: r.error!.code, message: r.error!.message } }];
      });
      write(next);
      if (!progressed) break;
    }
    return { sent, rejected };
  };
  flushing = run().finally(() => { flushing = null; });
  return flushing;
}
