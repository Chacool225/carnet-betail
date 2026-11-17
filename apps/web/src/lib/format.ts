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

export const ROLE_LABEL = { eleveur: 'Éleveur', vet: 'Vétérinaire', agent: 'Agent de terrain', autorite: 'Autorité' } as const;

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
