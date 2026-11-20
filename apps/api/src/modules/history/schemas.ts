import { z } from 'zod';
import { boolParam, dateParam, rangeCheck } from '../../lib/filters.js';
import { CATEGORIES } from '../../lib/history.js';

export const historyQuery = z
  .object({
    q: z.string().trim().max(80).optional(),
    category: z.enum(CATEGORIES).optional(),
    animalId: z.string().uuid().optional(),
    /** Seulement ce que j'ai fait moi-même. */
    mine: boolParam.optional(),
    from: dateParam.optional(),
    to: dateParam.optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .superRefine(rangeCheck([['from', 'to']]));
export type HistoryQuery = z.infer<typeof historyQuery>;

export const archiveParams = z.object({ id: z.string().uuid() });
