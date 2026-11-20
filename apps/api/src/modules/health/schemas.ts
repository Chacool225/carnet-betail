import { z } from 'zod';
import { boolParam, dateParam, rangeCheck } from '../../lib/filters.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ.').refine((d) => !Number.isNaN(Date.parse(d)), 'Date invalide.');
const today = () => new Date().toISOString().slice(0, 10);

export const createEventBody = z
  .object({
    type: z.enum(['vaccin', 'soin', 'controle']),
    label: z.string().trim().min(1).max(200),
    doneOn: isoDate,
    nextDueOn: isoDate.optional(),
    withdrawalDays: z.number().int().min(0).max(365).optional(),
    note: z.string().trim().max(1000).optional(),
    correctsEventId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.doneOn > today()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['doneOn'], message: "La date de l'acte est dans le futur." });
    if (v.nextDueOn && v.nextDueOn < v.doneOn) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nextDueOn'], message: 'Le rappel doit être après la date de l’acte.' });
  });
export type CreateEventBody = z.infer<typeof createEventBody>;

export const mortalityBody = z.object({
  qty: z.number().int().min(1).max(1_000_000),
  cause: z.string().trim().max(200).optional(),
  occurredOn: isoDate.optional(),
  note: z.string().trim().max(500).optional(),
});
export type MortalityBody = z.infer<typeof mortalityBody>;

export const createCaseBody = z.object({
  diseases: z.array(z.string().trim().min(2).max(80)).min(1).max(5),
  affectedCount: z.number().int().min(1).max(1_000_000),
  severity: z.enum(['legere', 'moyenne', 'grave']),
  symptoms: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  deaths: z.number().int().min(0).max(1_000_000).default(0),
  note: z.string().trim().max(1000).optional(),
});
export type CreateCaseBody = z.infer<typeof createCaseBody>;

export const updateCaseBody = z
  .object({ status: z.enum(['suivi', 'gueri', 'clos']).optional(), note: z.string().trim().max(1000).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à modifier.' });
export type UpdateCaseBody = z.infer<typeof updateCaseBody>;

export const remindersQuery = z.object({ days: z.coerce.number().int().min(0).max(365).default(30) });
export const caseParam = z.object({ caseId: z.string().uuid() });

export const eventsQuery = z
  .object({
    type: z.enum(['vaccin', 'soin', 'controle']).optional(),
    q: z.string().trim().max(80).optional(),
    from: dateParam.optional(),
    to: dateParam.optional(),
    /** Seulement les actes signés par un vétérinaire (true) ou non signés (false). */
    signed: boolParam.optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine(rangeCheck([['from', 'to']]));
export type EventsQuery = z.infer<typeof eventsQuery>;

export const casesQuery = z
  .object({
    status: z.enum(['ouvert', 'suivi', 'gueri', 'clos']).optional(),
    q: z.string().trim().max(80).optional(),
    from: dateParam.optional(),
    to: dateParam.optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine(rangeCheck([['from', 'to']]));
export type CasesQuery = z.infer<typeof casesQuery>;
