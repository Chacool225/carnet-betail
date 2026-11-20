import { z } from 'zod';
import { boolParam, dateParam, rangeCheck } from '../../lib/filters.js';

export const SPECIES = ['bovin', 'ovin', 'caprin', 'porcin', 'volaille', 'lapin', 'poisson'] as const;
export type Species = (typeof SPECIES)[number];

/** Préfixe du code public : CI-BOV-01000 */
export const SPECIES_PREFIX: Record<Species, string> = {
  bovin: 'BOV', ovin: 'OVI', caprin: 'CAP', porcin: 'POR', volaille: 'VOL', lapin: 'LAP', poisson: 'POI',
};

/** Volaille, lapin et poisson se gèrent en lots ; bovin, ovin et caprin un par un ; le porc des deux façons. */
export const LOT_ONLY: Species[] = ['volaille', 'lapin', 'poisson'];
export const INDIVIDUAL_ONLY: Species[] = ['bovin', 'ovin', 'caprin'];

export const MAX_PHOTOS = 10; // RG10

const rfid = z.string().trim().toUpperCase().regex(/^[0-9A-F]{10,24}$/, 'Boucle RFID : 10 à 24 caractères hexadécimaux.');
const photoUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^https:\/\/[^\s]+$/.test(u) || /^\/uploads\/[A-Za-z0-9._\/-]+$/.test(u), 'Adresse de photo invalide (https:// ou /uploads/…).');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ.').refine((d) => !Number.isNaN(Date.parse(d)), 'Date invalide.');

export const createAnimalBody = z
  .object({
    species: z.enum(SPECIES),
    kind: z.enum(['individual', 'lot']),
    name: z.string().trim().min(1).max(80),
    breed: z.string().trim().max(80).optional(),
    sex: z.enum(['M', 'F']).optional(),
    bornOn: isoDate.optional(),
    qty: z.number().int().min(1).max(1_000_000).optional(),
    avgWeightKg: z.number().positive().max(2000).optional(),
    rfid: rfid.optional(),
    zoneId: z.string().uuid().optional(),
    photoUrl: photoUrl.optional(),
  })
  .superRefine((v, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (LOT_ONLY.includes(v.species) && v.kind !== 'lot') add('kind', 'Cette espèce se gère en lot.');
    if (INDIVIDUAL_ONLY.includes(v.species) && v.kind !== 'individual') add('kind', 'Cette espèce se gère animal par animal.');
    if (v.kind === 'lot') {
      if (v.qty === undefined) add('qty', "L'effectif du lot est obligatoire.");
      if (v.rfid) add('rfid', "Une boucle RFID identifie un animal, pas un lot.");
      if (v.sex) add('sex', "Le sexe ne s'applique pas à un lot.");
    } else if (v.qty !== undefined) {
      add('qty', "L'effectif ne s'applique qu'à un lot.");
    }
    if (v.bornOn && v.bornOn > new Date().toISOString().slice(0, 10)) add('bornOn', 'La date de naissance est dans le futur.');
  });
export type CreateAnimalBody = z.infer<typeof createAnimalBody>;

export const updateAnimalBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    breed: z.string().trim().max(80).nullable().optional(),
    sex: z.enum(['M', 'F']).nullable().optional(),
    bornOn: isoDate.nullable().optional(),
    avgWeightKg: z.number().positive().max(2000).nullable().optional(),
    rfid: rfid.optional(),
    zoneId: z.string().uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à modifier.' });
export type UpdateAnimalBody = z.infer<typeof updateAnimalBody>;

export const listQuery = z
  .object({
    q: z.string().trim().max(80).optional(),
    species: z.enum(SPECIES).optional(),
    kind: z.enum(['individual', 'lot']).optional(),
    status: z.enum(['actif', 'vendu', 'abattu', 'decede', 'vole']).optional(),
    zoneId: z.string().uuid().optional(),
    /** `all` (éleveur) : inclut les animaux sortis du cheptel (vendus, transférés, abattus…), voir GET /animals/:id/archive. */
    scope: z.enum(['current', 'all']).default('current'),
    createdFrom: dateParam.optional(),
    createdTo: dateParam.optional(),
    bornFrom: dateParam.optional(),
    bornTo: dateParam.optional(),
    /** Date de sortie du cheptel (scope=all, éleveur). */
    exitFrom: dateParam.optional(),
    exitTo: dateParam.optional(),
    exited: boolParam.optional(),
    withdrawal: boolParam.optional(),
    openCase: boolParam.optional(),
    sort: z.enum(['name', 'created', 'born', 'species', 'updated', 'exit']).default('created'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .superRefine(rangeCheck([['createdFrom', 'createdTo'], ['bornFrom', 'bornTo'], ['exitFrom', 'exitTo']]));
export type ListQuery = z.infer<typeof listQuery>;

export const lookupQuery = z
  .object({ code: z.string().trim().toUpperCase().min(5).max(30).optional(), rfid: rfid.optional() })
  .refine((v) => !!v.code !== !!v.rfid, { message: 'Indiquez code ou rfid, pas les deux.' });

export const photoBody = z.object({ url: photoUrl });
export const idParam = z.object({ id: z.string().uuid() });
export const photoParams = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });
