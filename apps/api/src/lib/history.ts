/** Journal du compte : catégories et phrases lisibles à partir des lignes du journal d'audit. */
export const CATEGORIES = ['compte', 'animal', 'sante', 'mouvement', 'acces', 'marche', 'alerte'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Motifs LIKE des actions de chaque catégorie. */
export const CATEGORY_PATTERNS: Record<Category, string[]> = {
  compte: ['auth.%', 'vet.%'],
  animal: ['animal.created', 'animal.updated', 'animal.photo_%'],
  sante: ['health.%', 'animal.mortality', 'case.%'],
  mouvement: ['animal.sold', 'animal.slaughtered', 'animal.transferred', 'animal.theft_declared', 'animal.recovered'],
  acces: ['access.%'],
  marche: ['market.%'],
  alerte: ['alert.%'],
};

export function categoryOf(action: string): Category {
  for (const c of CATEGORIES) {
    for (const p of CATEGORY_PATTERNS[c]) {
      if (p.endsWith('%') ? action.startsWith(p.slice(0, -1)) : action === p) return c;
    }
  }
  return 'compte';
}

const EVENT_TYPE: Record<string, string> = { vaccin: 'Vaccin', soin: 'Soin', controle: 'Contrôle' };
const CASE_STATUS: Record<string, string> = { ouvert: 'ouvert', suivi: 'en suivi', gueri: 'guéri', clos: 'clos' };
const SOURCE: Record<string, string> = { scan: 'scan du QR', soin: 'soin', invitation: 'invitation du propriétaire', enregistrement: 'enregistrement' };

export interface LabelCtx { eventLabel?: string | null; byMe: boolean; actorName?: string | null }

/** Phrase courte : « Vente de 3 têtes », « Vaccin : charbon »… (sans le nom de l'animal, affiché à part). */
export function describeAction(action: string, d: Record<string, any> | null, ctx: LabelCtx): string {
  const x = d ?? {};
  switch (action) {
    case 'auth.register': return 'Création du compte';
    case 'auth.login': return 'Connexion';
    case 'auth.locked': return `Compte bloqué ${x.minutes ?? ''} minutes après trop d'essais`.replace('  ', ' ');
    case 'auth.password_changed': return 'Mot de passe changé';
    case 'auth.password_reset_requested': return 'Code de réinitialisation demandé';
    case 'auth.password_reset': return 'Mot de passe réinitialisé par code';
    case 'auth.pin_changed': return 'Code à 4 chiffres changé';
    case 'vet.verified': return "Numéro d'ordre d'un vétérinaire vérifié";
    case 'animal.created': return 'Fiche créée';
    case 'animal.updated': return 'Fiche modifiée';
    case 'animal.photo_added': return 'Photo ajoutée';
    case 'animal.photo_removed': return 'Photo retirée';
    case 'health.recorded': return `${EVENT_TYPE[x.type] ?? 'Acte'} enregistré${ctx.eventLabel ? ` : ${ctx.eventLabel}` : ''}`;
    case 'health.corrected': return `Acte corrigé${ctx.eventLabel ? ` : ${ctx.eventLabel}` : ''}`;
    case 'animal.mortality': return `Mortalité déclarée${x.qty ? ` (${x.qty})` : ''}`;
    case 'case.opened': return `Maladie signalée${Array.isArray(x.diseases) && x.diseases.length ? ` : ${x.diseases.join(', ')}` : ''}`;
    case 'case.updated': return `Signalement ${x.status ? `passé à « ${CASE_STATUS[x.status] ?? x.status} »` : 'mis à jour'}`;
    case 'animal.sold': return `Vente${x.qty ? ` de ${x.qty} tête(s)` : ''}${x.price != null ? ` pour ${x.price} FCFA` : ''}${x.buyerId ? ' à un éleveur inscrit' : ''}`;
    case 'animal.slaughtered': return `Abattage${x.qty ? ` de ${x.qty} tête(s)` : ''}`;
    case 'animal.transferred': return 'Transfert de propriété';
    case 'animal.theft_declared': return 'Vol déclaré';
    case 'animal.recovered': return 'Animal retrouvé';
    case 'access.granted': return `Accès vétérinaire accordé (${SOURCE[x.source] ?? x.source ?? 'accès'})`;
    case 'access.renewed': return `Accès vétérinaire prolongé (${SOURCE[x.source] ?? x.source ?? 'accès'})`;
    case 'access.revoked': return 'Accès vétérinaire retiré';
    case 'market.listed': return `Mise en vente${x.qty != null && x.qty > 1 ? ` de ${x.qty} têtes` : ''}${x.price != null ? ` à ${x.price} FCFA l'unité` : ''}${x.bulkMinQty != null ? ` (${x.bulkPrice} FCFA dès ${x.bulkMinQty})` : ''}`;
    case 'market.unlisted': return 'Annonce retirée';
    case 'market.request_sent': return `Demande d'achat envoyée${x.offeredPrice != null ? ` (offre : ${x.offeredPrice} FCFA)` : ''}`;
    case 'market.request_accepted': return "Demande d'achat acceptée";
    case 'market.request_refused': return "Demande d'achat refusée";
    case 'market.request_cancelled': return "Demande d'achat annulée";
    case 'market.agreement': return `Accord sur ${x.qty} × ${x.unitPrice} FCFA = ${x.total} FCFA`;
    case 'animal.split_received': return `Lot reçu : ${x.qty} têtes issues d'un lot vendu`;
    case 'market.sold_to_buyer': return `Vente finalisée${x.price != null ? ` pour ${x.price} FCFA` : ''}`;
    case 'alert.handled': return 'Alerte prise en charge';
    default: return action;
  }
}
