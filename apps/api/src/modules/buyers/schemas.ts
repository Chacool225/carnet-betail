import { z } from 'zod';
import { normalizePhone } from '../../lib/phone.js';

export const ORG_KINDS = ['restaurant', 'hotel', 'boucherie', 'traiteur', 'cooperative', 'marche', 'autre'] as const;

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

/** Qui achète : une profession, et éventuellement l'organisation représentée (restaurant, boucherie, coopérative…). */
export const buyerProfileBody = z
  .object({
    profession: opt(80),
    orgKind: z.enum(ORG_KINDS).optional(),
    orgName: opt(120),
    contactName: opt(80),
    contactPhone: z.string().trim().optional().transform((v, ctx) => {
      if (!v) return undefined;
      const p = normalizePhone(v);
      if (!p) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Numéro invalide : 10 chiffres attendus (ex. 07 12 34 56 78).' }); return undefined; }
      return p;
    }),
    locality: opt(120),
  })
  .superRefine((v, ctx) => {
    if (v.orgKind && !v.orgName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['orgName'], message: "Indiquez le nom de l'organisation." });
    if (v.orgName && !v.orgKind) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['orgKind'], message: "Indiquez le type d'organisation." });
  });
export type BuyerProfileBody = z.infer<typeof buyerProfileBody>;
