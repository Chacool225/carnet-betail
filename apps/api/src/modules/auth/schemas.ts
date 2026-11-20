import { z } from 'zod';
import { normalizePhone } from '../../lib/phone.js';
import { buyerProfileBody } from '../buyers/schemas.js';

export const phoneField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Numéro invalide : 10 chiffres attendus (ex. 07 12 34 56 78).' });
    return p ?? '';
  });

export const passwordField = z.string().min(8, '8 caractères au minimum.').max(128, '128 caractères au maximum.');
export const pinField = z.string().regex(/^[0-9]{4}$/, 'Le code doit faire exactement 4 chiffres.');

export const registerBody = z
  .object({
    role: z.enum(['eleveur', 'vet', 'particulier']),
    name: z.string().trim().min(2).max(80),
    phone: phoneField,
    email: z.string().trim().toLowerCase().email().max(120).optional(),
    password: passwordField,
    pin: pinField.optional(),
    zoneId: z.string().uuid().optional(),
    orderNumber: z.string().trim().min(3).max(40).optional(),
    clinic: z.string().trim().max(120).optional(),
    /** Profession ou organisation d'un particulier (facultatif, modifiable ensuite). */
    buyerProfile: buyerProfileBody.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'vet' && !v.orderNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['orderNumber'], message: "Le numéro d'ordre est obligatoire pour un vétérinaire." });
    }
    if (v.buyerProfile && v.role !== 'particulier') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buyerProfile'], message: 'Le profil acheteur est réservé aux particuliers.' });
    }
  });
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  identifier: z.string().trim().min(3).max(120), // e-mail ou téléphone
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof loginBody>;

export const pinLoginBody = z
  .object({
    userId: z.string().uuid().optional(),
    phone: phoneField.optional(),
    pin: pinField,
  })
  .refine((v) => !!v.userId !== !!v.phone, { message: 'Indiquez userId ou phone, pas les deux.' });
export type PinLoginBody = z.infer<typeof pinLoginBody>;

export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

export const updateMeBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    phone: phoneField.optional(),
    email: z.string().trim().toLowerCase().email().max(120).nullable().optional(),
    zoneId: z.string().uuid().nullable().optional(),
    prefs: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à modifier.' });
export type UpdateMeBody = z.infer<typeof updateMeBody>;

export const forgotBody = z.object({ phone: phoneField });
export const resetBody = z.object({ phone: phoneField, code: z.string().regex(/^\d{6}$/, 'Le code a 6 chiffres.'), newPassword: passwordField });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordField });
export const setPinBody = z.object({ password: z.string().min(1).max(128), pin: pinField });
