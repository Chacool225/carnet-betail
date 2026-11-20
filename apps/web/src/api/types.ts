export type Role = 'eleveur' | 'vet' | 'agent' | 'autorite' | 'particulier';
export type Species = 'bovin' | 'ovin' | 'caprin' | 'porcin' | 'volaille' | 'lapin' | 'poisson';
export type Status = 'actif' | 'vendu' | 'abattu' | 'decede' | 'vole';

export interface User {
  id: string; role: Role; name: string; phone: string; email: string | null;
  zone: { id: string; name: string } | null; photoUrl: string | null;
  vet: { orderNumber: string; clinic: string | null; verified: boolean } | null;
  prefs: { simple?: boolean; theme?: 'light' | 'dark' } & Record<string, unknown>;
  createdAt: string | null;
}
export interface AuthResult { accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresIn: number; user: User }
export interface Zone { id: string; name: string; lat: number | null; lng: number | null }

export interface Animal {
  id: string; code: string; kind: 'individual' | 'lot'; species: Species; breed: string | null; name: string;
  sex: 'M' | 'F' | null; bornOn: string | null; status: Status; qty: number | null; qtyInitial: number | null;
  avgWeightKg: number | null; rfid: string | null; zone: { id: string; name: string }; owner: { id: string; name: string };
  photos: { id: string; url: string }[]; createdAt: string | null; updatedAt: string | null;
  access?: 'owner' | 'vet' | 'agent' | 'autorite';
  /** Annonce en cours : prix à l'unité, quantité mise en vente et prix réduit éventuel. */
  listing?: { price: number; qty: number; bulkMinQty: number | null; bulkPrice: number | null; listedAt: string | null } | null;
  /** Présents seulement avec scope=all (éleveur) : « current » = dans le cheptel, « former » = sorti du cheptel. */
  relation?: 'current' | 'former';
  exit?: { type: ExitType; on: string } | null;
}
export type ExitType = 'vente' | 'transfert' | 'abattage' | 'deces' | 'vol';
export interface Page<T> { items: T[]; total: number; page: number; limit: number }
export interface AnimalCard {
  id: string; code: string; species: Species; kind: 'individual' | 'lot'; name: string; status: Status; zone: string;
  ownerName: string; stolen: boolean; access: Animal['access'] | null;
}
export interface HealthEvent {
  id: string; animalId: string; type: 'vaccin' | 'soin' | 'controle'; label: string; doneOn: string; nextDueOn: string | null;
  withdrawalDays: number | null; withdrawalUntil: string | null; note: string | null;
  recordedBy: { id: string; name: string; role: string }; vet: { id: string; name: string } | null; signedByVet: boolean;
  correctsEventId: string | null; correctedBy: string | null; createdAt: string | null;
}
export interface HealthSummary {
  withdrawalUntil: string | null; canSell: boolean;
  upcoming: { label: string; type: string; nextDueOn: string; overdue: boolean }[]; lastEvent: HealthEvent | null;
}
export interface Reminder { eventId: string; animal: { id: string; code: string; name: string }; type: string; label: string; dueOn: string; overdue: boolean }
export interface Case {
  id: string; animalId: string; diseases: string[]; notifiable: boolean; affectedCount: number; severity: 'legere' | 'moyenne' | 'grave';
  symptoms: string[]; deaths: number; status: 'ouvert' | 'suivi' | 'gueri' | 'clos'; note: string | null; openedOn: string; closedOn: string | null;
  openedBy: { id: string; name: string };
}
export interface Flow {
  id: string; type: string; qty: number | null; counterpart: string | null; note: string | null; occurredOn: string;
  recordedBy: { id: string; name: string }; createdAt: string | null;
}
export interface Grant { animalId: string; vetId: string; vetName: string; source: string; grantedOn: string; expiresOn: string; revokedOn: string | null; active: boolean }
export interface VetSummary { id: string; name: string; phone: string; zone: string | null; clinic: string | null; orderNumber: string }
export interface MarketItem {
  id: string; code: string; species: Species; kind: 'individual' | 'lot'; name: string; breed: string | null; sex: string | null; qty: number | null;
  avgWeightKg: number | null; price: number; listingQty: number | null; bulkMinQty: number | null; bulkPrice: number | null;
  listedAt: string; zone: string; ownerName: string; photoUrl: string | null;
}
export interface Alert {
  id: string; kind: 'vol' | 'sanitaire' | 'anomalie'; severity: 'haute' | 'moyenne' | 'basse'; zone: { id: string; name: string } | null;
  animal: { id: string; code: string; name: string } | null; title: string; why: string | null; createdOn: string; handled: boolean;
  handledBy: string | null; handledAt: string | null;
}
export interface StatsOverview {
  scope: 'national' | 'zone'; periodDays: number;
  animalsByStatus: { status: string; animals: number; heads: number }[];
  activeBySpecies: { species: string; animals: number; heads: number }[];
  topDiseases: { disease: string; cases: number; notifiable: boolean }[];
  openCases: number; deaths: number; unhandledAlerts: Record<string, number>; vets: { total: number; verified: number };
}
export interface ZoneStats {
  zone: Zone; animals: number; heads: number; openCases: number; deaths: number; mortalityRate: number; stolen: number; unhandledAlerts: number;
}
export interface AgentOverview { zone: { id: string; name: string } | null; animals: number; heads: number; openCases: number; stolen: number; unhandledAlerts: number }
export interface AccessItem { animal: { id: string; code: string; name: string; species: Species; kind: string; status: string; ownerName: string; zone: string }; source: string; expiresOn: string }

export type OpType = 'animal.create' | 'animal.update' | 'health.create' | 'mortality.declare' | 'case.create' | 'case.update' | 'sale' | 'theft.declare';
export interface SyncResult { clientId: string; status: 'ok' | 'error'; replayed: boolean; result?: Record<string, any>; error?: { code: string; message: string; status: number; details?: any } }

export type HistoryCategory = 'compte' | 'animal' | 'sante' | 'mouvement' | 'acces' | 'marche' | 'alerte';
export interface HistoryEntry {
  id: number; at: string; action: string; category: HistoryCategory; label: string; byMe: boolean;
  actor: { id: string; name: string; role: string } | null; animal: { id: string; code: string; name: string } | null;
}
export interface Archive {
  readOnly: true; cutoff: string; exit: { type: ExitType; on: string };
  animal: { id: string; code: string; kind: string; species: Species; name: string; breed: string | null; sex: 'M' | 'F' | null; bornOn: string | null; qtyInitial: number | null; rfid: string | null; createdAt: string | null };
  events: HealthEvent[]; cases: Case[]; flows: Flow[];
}

export type RequestStatus = 'en_attente' | 'acceptee' | 'refusee' | 'annulee' | 'conclue';
export type OrgKind = 'restaurant' | 'hotel' | 'boucherie' | 'traiteur' | 'cooperative' | 'marche' | 'autre';
export interface BuyerProfile {
  profession: string | null; orgKind: OrgKind | null; orgName: string | null; contactName: string | null; contactPhone: string | null; locality: string | null;
}
export interface Proposal { qty: number; unitPrice: number }
export interface PurchaseRequest {
  id: string; status: RequestStatus; message: string | null; qty: number; offeredPrice: number | null;
  /** Prix à l'unité convenu ; `agreedQty` et `agreedTotal` complètent l'accord. */
  agreedPrice: number | null; agreedQty: number | null; agreedTotal: number | null;
  listingPrice: number | null; bulkMinQty: number | null; bulkPrice: number | null;
  /** Ma dernière proposition et celle de l'autre partie. */
  mine: Proposal | null; theirs: Proposal | null;
  sellerNote: string | null; createdAt: string; decidedAt: string | null; completedAt: string | null;
  animal: { id: string; code: string; name: string; species: Species; kind: 'individual' | 'lot'; qty: number | null };
  /** L'autre partie : le téléphone n'apparaît qu'une fois l'accord conclu. */
  other: { name: string; phone: string | null };
  /** Vu par le vendeur seulement : profession ou organisation de l'acheteur. */
  buyerProfile: (BuyerProfile & { contactPhone: string | null }) | null;
}
export interface RequestDetail extends PurchaseRequest { side: 'buyer' | 'seller'; availableQty: number | null }
export interface ChatMessage {
  id: string; kind: 'text' | 'proposal' | 'recap' | 'system'; body: string; senderId: string | null; senderName: string | null; mine: boolean;
  qty: number | null; unitPrice: number | null; total: number | null; createdAt: string;
}
export interface MarketSheet {
  id: string; code: string; species: Species; kind: 'individual' | 'lot'; name: string; breed: string | null; sex: 'M' | 'F' | null; bornOn: string | null;
  qty: number | null; avgWeightKg: number | null; price: number; bulkMinQty: number | null; bulkPrice: number | null; listingQty: number; availableQty: number;
  listedAt: string; zone: string; ownerName: string;
  photos: { id: string; url: string }[];
  health: { vaccines: { label: string; doneOn: string; signedByVet: boolean }[]; openCases: number };
  isMine: boolean; myRequest: { id: string; status: RequestStatus } | null;
}
export interface AppNotification { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string }

export interface HealthMap {
  periodDays: number; disease: string | null;
  items: { zone: { id: string; name: string; lat: number | null; lng: number | null }; cases: number; animals: number; openCases: number; deaths: number }[];
  diseases: { disease: string; cases: number; notifiable: boolean }[];
}
export interface CasesTimeline { periodDays: number; disease: string | null; zoneId: string | null; points: { weekStart: string; cases: number; deaths: number }[] }
export interface AuditEntry {
  id: number; at: string; action: string; category: HistoryCategory; label: string;
  actor: { id: string; name: string; role: string } | null; animal: { id: string; code: string; name: string } | null; detail: Record<string, unknown> | null;
}
