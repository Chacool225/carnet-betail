/** Montants en FCFA, sans décimales. Espace insécable remplacé par une espace simple pour les SMS et les messages. */
export const fcfa = (n: number): string => `${new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ')} FCFA`;

export interface Tier { price: number; bulkMinQty: number | null; bulkPrice: number | null }

/** Prix à l'unité pour une quantité donnée : le prix réduit s'applique dès que le seuil est atteint. */
export function unitPriceFor(t: Tier, qty: number): number {
  return t.bulkMinQty != null && t.bulkPrice != null && qty >= t.bulkMinQty ? t.bulkPrice : t.price;
}

export const totalFor = (t: Tier, qty: number): number => unitPriceFor(t, qty) * qty;

export const tierOf = (r: Record<string, any>): Tier => ({
  price: Number(r.listing_price),
  bulkMinQty: r.bulk_min_qty == null ? null : Number(r.bulk_min_qty),
  bulkPrice: r.bulk_price == null ? null : Number(r.bulk_price),
});

const UNITS: Record<string, [string, string]> = {
  bovin: ['bovin', 'bovins'], ovin: ['ovin', 'ovins'], caprin: ['caprin', 'caprins'], porcin: ['porc', 'porcs'],
  volaille: ['volaille', 'volailles'], lapin: ['lapin', 'lapins'], poisson: ['poisson', 'poissons'],
};
/** « 150 volailles », « 1 bovin ». */
export const unitsLabel = (species: string, n: number): string => `${n} ${(UNITS[species] ?? ['animal', 'animaux'])[n > 1 ? 1 : 0]}`;
