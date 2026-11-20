import { z } from 'zod';

/** Date AAAA-MM-JJ valide. */
export const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ.')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Date invalide.');

/** « true » ou « false » dans l'adresse. */
export const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Vérifie que chaque paire début/fin est dans le bon ordre. */
export function rangeCheck(pairs: [string, string][]) {
  return (v: Record<string, unknown>, ctx: z.RefinementCtx): void => {
    for (const [a, b] of pairs) {
      const from = v[a] as string | undefined;
      const to = v[b] as string | undefined;
      if (from && to && from > to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [b], message: 'La date de fin est avant la date de début.' });
    }
  };
}

export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Ajoute un paramètre SQL et renvoie son numéro ($n). */
export function pusher(params: unknown[]) {
  return (v: unknown): number => {
    params.push(v);
    return params.length;
  };
}
