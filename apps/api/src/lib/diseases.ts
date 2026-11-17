/**
 * Maladies à déclaration obligatoire (RG7). Liste de travail pour le hackathon : à faire valider
 * par un vétérinaire ou la direction des services vétérinaires avant tout usage réel.
 */
export const NOTIFIABLE_DISEASES: readonly string[] = [
  'fièvre aphteuse',
  'peste porcine africaine',
  'grippe aviaire',
  'maladie de newcastle',
  'peste des petits ruminants',
  'charbon bactéridien',
  'brucellose',
  'tuberculose bovine',
  'rage',
  'fièvre de la vallée du rift',
];

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** Noms courants et sigles qui désignent la même maladie. */
const ALIASES = ['newcastle', 'ppr', 'peste porcine', 'aphteuse', 'charbon', 'tuberculose', 'vallee du rift', 'influenza aviaire'];
const KEYS = [...NOTIFIABLE_DISEASES, ...ALIASES].map(norm);
const escape = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = KEYS.map((k) => new RegExp(`(^|[^a-z])${escape(k)}([^a-z]|$)`));

/** Vrai si le texte désigne une maladie à déclaration obligatoire (sans tenir compte des accents ni des majuscules). */
export const isNotifiable = (disease: string): boolean => {
  const d = norm(disease);
  return PATTERNS.some((re) => re.test(d));
};
