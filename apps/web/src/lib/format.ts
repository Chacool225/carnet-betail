import type { Species, Status } from '../api/types';

export const SPECIES: Record<Species, { label: string; plural: string; icon: string; lot: boolean; single: boolean }> = {
  bovin: { label: 'Bovin', plural: 'bovins', icon: '🐄', lot: false, single: true },
  ovin: { label: 'Ovin', plural: 'ovins', icon: '🐑', lot: false, single: true },
  caprin: { label: 'Caprin', plural: 'caprins', icon: '🐐', lot: false, single: true },
  porcin: { label: 'Porcin', plural: 'porcins', icon: '🐖', lot: true, single: true },
  volaille: { label: 'Volaille', plural: 'volailles', icon: '🐔', lot: true, single: false },
  lapin: { label: 'Lapin', plural: 'lapins', icon: '🐇', lot: true, single: false },
  poisson: { label: 'Poisson', plural: 'poissons', icon: '🐟', lot: true, single: false },
};
export const SPECIES_LIST = Object.keys(SPECIES) as Species[];

export const STATUS: Record<Status, { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'grey' }> = {
  actif: { label: 'Actif', tone: 'green' },
  vendu: { label: 'Vendu', tone: 'blue' },
  abattu: { label: 'Abattu', tone: 'grey' },
  decede: { label: 'Décédé', tone: 'grey' },
  vole: { label: 'Volé', tone: 'red' },
};

export const ROLE_LABEL = { eleveur: 'Éleveur', vet: 'Vétérinaire', agent: 'Agent de terrain', autorite: 'Autorité', particulier: 'Particulier' } as const;
export const REQUEST_STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'grey' }> = {
  en_attente: { label: 'En attente', tone: 'amber' }, acceptee: { label: 'Acceptée', tone: 'green' }, refusee: { label: 'Refusée', tone: 'red' },
  annulee: { label: 'Annulée', tone: 'grey' }, conclue: { label: 'Vente conclue', tone: 'blue' },
};

const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
export const date = (d: string | null | undefined): string => {
  if (!d) return '—';
  const x = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return Number.isNaN(x.getTime()) ? '—' : fmtDate.format(x);
};
export const dateTime = (d: string | null | undefined): string =>
  d ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—';
export const todayIso = (): string => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const fcfa = (n: number): string => `${new Intl.NumberFormat('fr-FR').format(n)} FCFA`;
export const num = (n: number): string => new Intl.NumberFormat('fr-FR').format(n);
export const pct = (r: number): string => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(r * 100)} %`;

/** Téléphone affiché par paires : 07 12 34 56 78. */
export const phone = (p: string): string => p.replace(/(\d{2})(?=\d)/g, '$1 ').trim();

export const headcount = (a: { kind: string; qty: number | null; species: Species }): string =>
  a.kind === 'lot' ? `${num(a.qty ?? 0)} ${SPECIES[a.species].plural}` : '1 animal';

/** « 150 volailles », « 1 bovin ». */
export const unitsLabel = (species: Species, n: number): string => `${num(n)} ${n > 1 ? SPECIES[species].plural : SPECIES[species].label.toLowerCase()}`;

/** Prix à l'unité pour une quantité : le prix réduit s'applique dès que le seuil est atteint. */
export const unitPriceFor = (t: { price: number; bulkMinQty: number | null; bulkPrice: number | null }, qty: number): number =>
  t.bulkMinQty != null && t.bulkPrice != null && qty >= t.bulkMinQty ? t.bulkPrice : t.price;

export const ORG_KIND: Record<string, string> = {
  restaurant: 'Restaurant', hotel: 'Hôtel', boucherie: 'Boucherie', traiteur: 'Traiteur', cooperative: 'Coopérative', marche: 'Marché', autre: 'Autre organisation',
};

export const SEVERITY: Record<string, string> = { legere: 'Légère', moyenne: 'Moyenne', grave: 'Grave' };
export const CASE_STATUS: Record<string, string> = { ouvert: 'Ouvert', suivi: 'En suivi', gueri: 'Guéri', clos: 'Clos' };
export const EVENT_TYPE: Record<string, string> = { vaccin: 'Vaccin', soin: 'Soin', controle: 'Contrôle' };
export const FLOW_LABEL: Record<string, string> = {
  entree: 'Entrée', mortalite: 'Mortalité', vente: 'Vente', vol: 'Vol', abattage: 'Abattage', pesee: 'Pesée', identification: 'Identification',
};

/** Messages d'erreur du serveur en français courant, quand un code mérite une explication plus utile que le texte brut. */
export const errorText = (e: unknown): string => {
  const x = e as { code?: string; message?: string; details?: any };
  switch (x?.code) {
    case 'withdrawal_active': return `Délai d'attente en cours jusqu'au ${date(x.details?.until)}. Vente et abattage impossibles avant.`;
    case 'animal_locked': return 'Cet animal est déclaré volé : sa fiche est bloquée.';
    case 'qty_exceeds_stock': return `Il ne reste que ${x.details?.available ?? '?'} animaux dans ce lot.`;
    case 'photo_limit': return 'Dix photos au maximum par fiche.';
    case 'rfid_taken': return 'Cette boucle RFID est déjà enregistrée sur une autre fiche.';
    case 'vet_not_verified': return "Le numéro d'ordre de ce vétérinaire n'a pas encore été vérifié.";
    case 'account_locked': return 'Trop de tentatives : compte bloqué quelques minutes.';
    case 'invalid_credentials': return 'Identifiants incorrects.';
    case 'conflict_stale': return 'Cette fiche a été modifiée ailleurs. Rechargez-la avant de réessayer.';
    default: return x?.message ?? 'Une erreur est survenue.';
  }
};

export const EXIT_LABEL: Record<string, string> = { vente: 'Vendu', transfert: 'Transféré', abattage: 'Abattu', deces: 'Décédé', vol: 'Volé' };
export const HISTORY_CATEGORY: Record<string, string> = {
  compte: 'Compte', animal: 'Fiches', sante: 'Santé', mouvement: 'Mouvements', acces: 'Accès vétérinaires', marche: 'Marché', alerte: 'Alertes',
};
/** Date ISO (AAAA-MM-JJ) décalée de n jours à partir d'aujourd'hui. */
export const daysAgoIso = (n: number): string => new Date(Date.now() - new Date().getTimezoneOffset() * 60000 - n * 86400000).toISOString().slice(0, 10);
