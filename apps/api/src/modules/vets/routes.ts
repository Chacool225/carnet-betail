import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { authenticate, authOf, requireRole } from '../../plugins/auth.js';
import { idempotent } from '../../plugins/idempotency.js';
import { writeAudit } from '../../lib/audit.js';
import { normalizePhone } from '../../lib/phone.js';

const idParam = z.object({ id: z.string().uuid() });

export async function vetRoutes(app: FastifyInstance): Promise<void> {
  /** Vétérinaires vérifiés : un éleveur les choisit pour leur donner l'accès à un animal (lot 3). */
  app.get('/vets', { preHandler: [authenticate] }, async (req) => {
    const q = z.object({ zoneId: z.string().uuid().optional() }).parse(req.query);
    const rows = await app.db.query(
      `SELECT u.id, u.name, u.phone, z.name AS zone, v.clinic, v.order_number
       FROM vets v JOIN users u ON u.id = v.user_id LEFT JOIN zones z ON z.id = u.zone_id
       WHERE v.verified AND ($1::uuid IS NULL OR u.zone_id = $1)
       ORDER BY u.name`,
      [q.zoneId ?? null],
    );
    return {
      items: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, zone: r.zone ?? null, clinic: r.clinic ?? null, orderNumber: r.order_number })),
    };
  });

  /** Vétérinaires en attente de vérification du numéro d'ordre (autorité). */
  app.get('/vets/pending', { preHandler: [authenticate, requireRole('autorite')] }, async () => {
    const rows = await app.db.query(
      `SELECT u.id, u.name, u.phone, z.name AS zone, v.clinic, v.order_number, u.created_at
       FROM vets v JOIN users u ON u.id = v.user_id LEFT JOIN zones z ON z.id = u.zone_id
       WHERE NOT v.verified ORDER BY u.created_at`,
    );
    return {
      items: rows.map((r) => ({
        id: r.id, name: r.name, phone: r.phone, zone: r.zone ?? null, clinic: r.clinic ?? null, orderNumber: r.order_number,
        registeredAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      })),
    };
  });

  /** Retrouver un autre éleveur par son téléphone (pour une vente ou un transfert). Limité pour éviter le balayage des numéros. */
  const strict = app.config.rateLimitEnabled ? { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } } : {};
  app.get('/eleveurs/lookup', { preHandler: [authenticate, requireRole('eleveur')], ...strict }, async (req) => {
    const q = z.object({ phone: z.string().trim().min(8).max(20) }).parse(req.query);
    const phone = normalizePhone(q.phone);
    const rows = phone
      ? await app.db.query(
          `SELECT u.id, u.name, z.name AS zone FROM users u LEFT JOIN zones z ON z.id = u.zone_id
           WHERE u.phone = $1 AND u.role = 'eleveur' AND u.id <> $2`,
          [phone, authOf(req).userId],
        )
      : [];
    if (!rows.length) throw notFound('Aucun éleveur avec ce numéro.', 'user_not_found');
    return { id: rows[0]!.id, name: rows[0]!.name, zone: rows[0]!.zone ?? null };
  });

  /** Validation du numéro d'ordre par une autorité. */
  app.post('/vets/:id/verify', { preHandler: [authenticate, requireRole('autorite'), idempotent] }, async (req) => {
    const { id } = idParam.parse(req.params);
    return app.db.tx(async (q) => {
      const rows = await q.query('UPDATE vets SET verified = true WHERE user_id = $1 RETURNING user_id', [id]);
      if (!rows.length) throw notFound('Vétérinaire introuvable.');
      await writeAudit(q, { actorId: authOf(req).userId, action: 'vet.verified', detail: { vetId: id } });
      return { id, verified: true };
    });
  });
}
