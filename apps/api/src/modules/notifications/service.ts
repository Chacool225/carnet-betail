import type { Db } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';
import { iso } from '../../lib/audit.js';
import type { AuthContext } from '../../plugins/auth.js';

export async function listNotifications(db: Db, auth: AuthContext, f: { unread: boolean; page: number; limit: number }) {
  const where = f.unread ? 'user_id = $1 AND read_at IS NULL' : 'user_id = $1';
  const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE ${where}`, [auth.userId]))[0]!.n;
  const unread = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [auth.userId]))[0]!.n;
  const rows = await db.query(
    `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC, id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`,
    [auth.userId],
  );
  return {
    items: rows.map((r) => ({ id: r.id as string, kind: r.kind as string, title: r.title as string, body: (r.body ?? null) as string | null, link: (r.link ?? null) as string | null, read: r.read_at != null, createdAt: iso(r.created_at)! })),
    total, unread, page: f.page, limit: f.limit,
  };
}

export async function markRead(db: Db, auth: AuthContext, id: string): Promise<void> {
  const r = await db.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id', [id, auth.userId]);
  if (!r.length) throw notFound('Notification introuvable.');
}

export async function markAllRead(db: Db, auth: AuthContext): Promise<number> {
  return (await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id', [auth.userId])).length;
}
