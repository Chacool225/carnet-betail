import { z } from 'zod';
import { dateParam, rangeCheck } from '../../lib/filters.js';

export const requestBody = z.object({
  message: z.string().trim().max(500).optional(),
  /** Nombre d'animaux voulus ; par défaut 1 pour un animal seul, tout ce qui est disponible pour un lot. */
  qty: z.number().int().min(1).max(1_000_000).optional(),
  /** Prix à l'unité proposé ; par défaut le prix de l'annonce pour cette quantité. */
  offeredPrice: z.number().int().min(0).max(1_000_000_000).optional(),
});
export type RequestBody = z.infer<typeof requestBody>;

export const noteBody = z.object({ note: z.string().trim().max(500).optional() });
export const completeBody = z.object({ occurredOn: dateParam.optional() });

export const STATUSES = ['en_attente', 'acceptee', 'refusee', 'annulee', 'conclue'] as const;

export const requestsQuery = z
  .object({
    status: z.enum(STATUSES).optional(),
    q: z.string().trim().max(80).optional(),
    from: dateParam.optional(),
    to: dateParam.optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .superRefine(rangeCheck([['from', 'to']]));
export type RequestsQuery = z.infer<typeof requestsQuery>;

export const idParam = z.object({ id: z.string().uuid() });

/** Proposition de l'une des parties : quand les deux propositions sont identiques, l'accord est conclu. */
export const proposalBody = z.object({
  qty: z.number().int().min(1).max(1_000_000),
  unitPrice: z.number().int().min(0).max(1_000_000_000),
});
export type ProposalBody = z.infer<typeof proposalBody>;

export const messageBody = z.object({ body: z.string().trim().min(1, 'Message vide.').max(1000) });
