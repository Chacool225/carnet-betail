import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ.').refine((d) => !Number.isNaN(Date.parse(d)), 'Date invalide.');
const notFuture = (v: { occurredOn?: string }, ctx: z.RefinementCtx) => {
  if (v.occurredOn && v.occurredOn > new Date().toISOString().slice(0, 10)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['occurredOn'], message: 'La date est dans le futur.' });
  }
};

export const sellBody = z
  .object({
    qty: z.number().int().min(1).max(1_000_000).optional(),
    buyerId: z.string().uuid().optional(),
    counterpart: z.string().trim().max(120).optional(),
    price: z.number().int().min(0).max(1_000_000_000).optional(),
    occurredOn: isoDate.optional(),
  })
  .superRefine(notFuture);
export type SellBody = z.infer<typeof sellBody>;

export const slaughterBody = z
  .object({ qty: z.number().int().min(1).max(1_000_000).optional(), occurredOn: isoDate.optional(), note: z.string().trim().max(500).optional() })
  .superRefine(notFuture);
export type SlaughterBody = z.infer<typeof slaughterBody>;

export const transferBody = z
  .object({ toUserId: z.string().uuid(), occurredOn: isoDate.optional(), note: z.string().trim().max(500).optional() })
  .superRefine(notFuture);
export type TransferBody = z.infer<typeof transferBody>;

export const theftBody = z
  .object({ occurredOn: isoDate.optional(), note: z.string().trim().max(500).optional() })
  .superRefine(notFuture);
export type TheftBody = z.infer<typeof theftBody>;

export const recoveryBody = z.object({ note: z.string().trim().max(500).optional() });

export const listingBody = z.object({ price: z.number().int().min(0).max(1_000_000_000) });

export const marketQuery = z.object({
  q: z.string().trim().max(80).optional(),
  species: z.enum(['bovin', 'ovin', 'caprin', 'porcin', 'volaille', 'lapin', 'poisson']).optional(),
  zoneId: z.string().uuid().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['price', 'listed']).default('listed'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MarketQuery = z.infer<typeof marketQuery>;
