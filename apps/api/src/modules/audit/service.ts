import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { forbidden } from '../../lib/errors.js';
import { dateParam, escapeLike, pusher, rangeCheck } from '../../lib/filters.js';
import { iso } from '../../lib/audit.js';
import { CATEGORY_PATTERNS, CATEGORIES, categoryOf, describeAction } from '../../lib/history.js';
import type { AuthContext } from '../../plugins/auth.js';

export const auditQuery = z
  .object({
    q: z.string().trim().max(80).optional(),
    actorId: z.string().uuid().optional(),
    animalId: z.string().uuid().optional(),
    category: z.enum(CATEGORIES).optional(),
    role: z.enum(['eleveur', 'vet', 'agent', 'autorite', 'particulier']).optional(),
    from: dateParam.optional(),
    to: dateParam.optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .superRefine(rangeCheck([['from', 'to']]));
export type AuditQuery = z.infer<typeof auditQuery>;

const parse = (d: unknown): Record<string, any> | null => {
  if (d == null) return null;
  if (typeof d === 'string') { try { return JSON.parse(d); } catch { return null; } }
  return d as Record<string, any>;
};

/** Journal d'audit de toute la plateforme, réservé à l'autorité (qui a fait quoi, quand, sur quel animal). */
export async function listAudit(db: Db, auth: AuthContext, f: AuditQuery) {
  if (auth.role !== 'autorite') throw forbidden("Le journal d'audit est réservé à l'autorité.");
  const params: unknown[] = [];
  const p = pusher(params);
  const where: string[] = ['TRUE'];
  if (f.actorId) where.push(`l.actor_id = $${p(f.actorId)}`);
  if (f.animalId) where.push(`l.animal_id = $${p(f.animalId)}`);
  if (f.role) where.push(`u.role = $${p(f.role)}`);
  if (f.category) where.push(`l.action LIKE ANY($${p(CATEGORY_PATTERNS[f.category])}::text[])`);
  if (f.from) where.push(`l.at >= $${p(f.from)}::date`);
  if (f.to) where.push(`l.at < ($${p(f.to)}::date + 1)`);
  if (f.q) {
    const n = p(`%${escapeLike(f.q)}%`);
    where.push(`(a.name ILIKE $${n} OR a.public_code ILIKE $${n} OR u.name ILIKE $${n} OR u.phone ILIKE $${n} OR l.action ILIKE $${n})`);
  }
  const w = where.join(' AND ');
  const from = `FROM audit_log l LEFT JOIN animals a ON a.id = l.animal_id LEFT JOIN users u ON u.id = l.actor_id WHERE ${w}`;
  const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n ${from}`, params))[0]!.n;
  const dir = f.order === 'asc' ? 'ASC' : 'DESC';
  const rows = await db.query(
    `SELECT l.id, l.at, l.action, l.detail, l.animal_id, l.actor_id, a.public_code, a.name AS animal_name, u.name AS actor_name, u.role AS actor_role
     ${from} ORDER BY l.at ${dir}, l.id ${dir} LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  return {
    items: rows.map((r) => ({
      id: Number(r.id), at: iso(r.at)!, action: r.action as string, category: categoryOf(r.action as string),
      label: describeAction(r.action as string, parse(r.detail), { eventLabel: null, byMe: false, actorName: r.actor_name as string | null }),
      actor: r.actor_id ? { id: r.actor_id as string, name: r.actor_name as string, role: r.actor_role as string } : null,
      animal: r.animal_id ? { id: r.animal_id as string, code: r.public_code as string, name: r.animal_name as string } : null,
      detail: parse(r.detail),
    })),
    total, page: f.page, limit: f.limit,
  };
}
