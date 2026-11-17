/**
 * Numéros de téléphone ivoiriens : 10 chiffres (ex. 07 12 34 56 78).
 * Accepte les espaces, points, tirets, et les préfixes +225, 00225, 225.
 * Renvoie les 10 chiffres, ou null si le numéro n'est pas valide.
 */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 13 && d.startsWith('225')) d = d.slice(3);
  return /^[0-9]{10}$/.test(d) ? d : null;
}
