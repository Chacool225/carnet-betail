export type Role = 'eleveur' | 'vet' | 'agent' | 'autorite';
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
}
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
  avgWeightKg: number | null; price: number; listedAt: string; zone: string; ownerName: string; photoUrl: string | null;
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
