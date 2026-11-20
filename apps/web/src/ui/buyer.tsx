import type { BuyerProfile } from '../api/types';
import { Field } from './kit';
import { ORG_KIND } from '../lib/format';

/** Ce que l'acheteur renseigne : sa profession et, s'il achète pour une organisation, les informations de celle-ci. */
export interface BuyerForm { profession: string; isOrg: boolean; orgKind: string; orgName: string; contactName: string; contactPhone: string; locality: string }
export const emptyBuyer: BuyerForm = { profession: '', isOrg: false, orgKind: 'restaurant', orgName: '', contactName: '', contactPhone: '', locality: '' };

export const buyerFromProfile = (p: BuyerProfile | null): BuyerForm => p
  ? { profession: p.profession ?? '', isOrg: !!p.orgName, orgKind: p.orgKind ?? 'restaurant', orgName: p.orgName ?? '', contactName: p.contactName ?? '', contactPhone: p.contactPhone ?? '', locality: p.locality ?? '' }
  : emptyBuyer;

/** Corps de requête : les champs vides sont omis, et ceux de l'organisation aussi quand l'acheteur n'en représente pas. */
export function buyerBody(b: BuyerForm): Record<string, string> {
  const o: Record<string, string> = {};
  if (b.profession.trim()) o.profession = b.profession.trim();
  if (b.locality.trim()) o.locality = b.locality.trim();
  if (b.isOrg) {
    o.orgKind = b.orgKind;
    if (b.orgName.trim()) o.orgName = b.orgName.trim();
    if (b.contactName.trim()) o.contactName = b.contactName.trim();
    if (b.contactPhone.trim()) o.contactPhone = b.contactPhone.trim();
  }
  return o;
}

export function BuyerFields({ value, onChange, errors = {} }: { value: BuyerForm; onChange: (v: BuyerForm) => void; errors?: Record<string, string> }) {
  const set = <K extends keyof BuyerForm>(k: K, v: BuyerForm[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <Field label="Profession (facultatif)" hint="Restaurateur, boucher, revendeur, particulier…" error={errors.profession}>{(id) => <input id={id} value={value.profession} maxLength={80} onChange={(e) => set('profession', e.target.value)} />}</Field>
      <Field label="Localité (facultatif)" hint="Quartier, ville ou village où vous achetez." error={errors.locality}>{(id) => <input id={id} value={value.locality} maxLength={120} onChange={(e) => set('locality', e.target.value)} />}</Field>
      <label className="switch"><input type="checkbox" checked={value.isOrg} onChange={(e) => set('isOrg', e.target.checked)} /> <span><b>J'achète pour une organisation</b><br /><span className="mute">Restaurant, hôtel, boucherie, traiteur, coopérative…</span></span></label>
      {value.isOrg && (
        <>
          <Field label="Type d'organisation" error={errors.orgKind}>{(id) => <select id={id} value={value.orgKind} onChange={(e) => set('orgKind', e.target.value)}>{Object.entries(ORG_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <Field label="Nom de l'organisation" error={errors.orgName}>{(id) => <input id={id} value={value.orgName} maxLength={120} onChange={(e) => set('orgName', e.target.value)} required />}</Field>
          <Field label="Nom du responsable" error={errors.contactName}>{(id) => <input id={id} value={value.contactName} maxLength={80} onChange={(e) => set('contactName', e.target.value)} />}</Field>
          <Field label="Téléphone du responsable" hint="Transmis au vendeur seulement après un accord." error={errors.contactPhone}>{(id) => <input id={id} value={value.contactPhone} inputMode="tel" onChange={(e) => set('contactPhone', e.target.value)} />}</Field>
        </>
      )}
    </>
  );
}

/** Une ligne lisible : « Restaurant Le Baobab · Restaurateur · Cocody ». */
export function buyerSummary(p: BuyerProfile): string {
  return [p.orgName ? `${ORG_KIND[p.orgKind ?? 'autre'] ?? 'Organisation'} ${p.orgName}` : null, p.profession, p.locality].filter(Boolean).join(' · ');
}
