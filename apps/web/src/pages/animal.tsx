import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, photoSrc, qs } from '../api/client';
import { submitOp } from '../api/offline';
import type { Animal, Case, Flow, Grant, HealthEvent, HealthSummary, VetSummary } from '../api/types';
import { Badge, Card, Empty, ErrorBox, Field, Icon, Modal, PageHead, QrCode, Spinner, useAction, useQuery, useToast } from '../ui/kit';
import { useAuth } from '../ui/auth';
import { Link, back, navigate, useLoc } from '../lib/router';
import { DateRange, ResetFilters, SearchBox } from '../ui/filters';
import { CASE_STATUS, EVENT_TYPE, FLOW_LABEL, SEVERITY, SPECIES, STATUS, date, dateTime, errorText, fcfa, headcount, num, phone, todayIso, unitsLabel } from '../lib/format';

type ModalName = null | 'event' | 'mortalite' | 'case' | 'sale' | 'slaughter' | 'transfer' | 'theft' | 'recovery' | 'listing' | 'invite' | 'photo' | 'edit';
type Tab = 'resume' | 'sante' | 'mouvements' | 'acces' | 'photos';

const SYMPTOMS: [string, string][] = [
  ['fièvre', '🌡️'], ['toux', '😮‍💨'], ['diarrhée', '💧'], ['boiterie', '🦵'], ['plaies', '🩹'], ['perte d\'appétit', '🍽️'],
  ['gonflement', '🎈'], ['écoulement', '👃'], ['mort subite', '💀'], ['nodules sur la peau', '🔴'],
];

/** Envoie une opération synchronisable et dit à l'utilisateur si elle est partie ou mise en attente. */
function useOp(done: () => void) {
  const toast = useToast();
  const { busy, run } = useAction();
  const send = async (type: Parameters<typeof submitOp>[0], payload: Record<string, unknown>, label: string, okMsg: string, onFieldErrors?: (m: Record<string, string>) => void) => {
    const r = await run(async () => {
      try { return await submitOp(type, payload, label); }
      catch (err) {
        if (onFieldErrors && err instanceof ApiError && err.status === 422 && Array.isArray(err.details)) {
          const m: Record<string, string> = {};
          for (const d of err.details) if (d.path?.length && !m[d.path[d.path.length - 1]]) m[d.path[d.path.length - 1]] = d.message;
          onFieldErrors(m);
        }
        throw err;
      }
    });
    if (!r) return false;
    toast(r.queued ? 'Enregistré sur le téléphone, envoi au retour du réseau.' : okMsg, r.queued ? 'info' : 'ok');
    done();
    return true;
  };
  return { busy, send };
}

function Footer({ onClose, busy, label, danger }: { onClose: () => void; busy: boolean; label: string; danger?: boolean }) {
  return (
    <div className="actions end">
      <button type="button" className="btn" onClick={onClose}>Annuler</button>
      <button className={`btn ${danger ? 'danger' : 'pri'}`} disabled={busy}>{busy ? 'Envoi…' : label}</button>
    </div>
  );
}

function EventModal({ a, onClose, onDone, correct }: { a: Animal; onClose: () => void; onDone: () => void; correct?: HealthEvent }) {
  const { user } = useAuth();
  const [f, setF] = useState({ type: correct?.type ?? 'vaccin', label: correct?.label ?? '', doneOn: todayIso(), nextDueOn: '', withdrawalDays: '', note: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const { busy, send } = useOp(() => { onDone(); onClose(); });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr({});
    const p: Record<string, unknown> = { animalId: a.id, type: f.type, label: f.label.trim(), doneOn: f.doneOn };
    if (f.nextDueOn) p.nextDueOn = f.nextDueOn;
    if (f.withdrawalDays !== '') p.withdrawalDays = Number(f.withdrawalDays);
    if (f.note.trim()) p.note = f.note.trim();
    if (correct) p.correctsEventId = correct.id;
    void send('health.create', p, `${EVENT_TYPE[f.type]} : ${f.label.trim()} (${a.name})`, correct ? 'Correction enregistrée' : 'Acte enregistré', setErr);
  };
  return (
    <Modal title={correct ? 'Corriger un acte' : 'Ajouter un acte de santé'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {correct && <p className="banner info">L'acte d'origine reste visible : une correction s'ajoute, elle ne l'efface pas.</p>}
        <Field label="Type">{(id) => <select id={id} value={f.type} onChange={set('type')}>{Object.entries(EVENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
        <Field label="Intitulé" error={err.label}>{(id) => <input id={id} value={f.label} onChange={set('label')} required maxLength={200} placeholder="Vaccin charbon symptomatique" />}</Field>
        <Field label="Date de l'acte" error={err.doneOn}>{(id) => <input id={id} type="date" value={f.doneOn} max={todayIso()} onChange={set('doneOn')} required />}</Field>
        <Field label="Prochain rappel (facultatif)" error={err.nextDueOn}>{(id) => <input id={id} type="date" value={f.nextDueOn} min={f.doneOn} onChange={set('nextDueOn')} />}</Field>
        {f.type === 'soin' && <Field label="Délai d'attente (jours)" hint="Pendant ce délai, vente et abattage sont bloqués." error={err.withdrawalDays}>{(id) => <input id={id} type="number" min={0} max={365} value={f.withdrawalDays} onChange={set('withdrawalDays')} inputMode="numeric" />}</Field>}
        <Field label="Note (facultatif)" error={err.note}>{(id) => <textarea id={id} value={f.note} onChange={set('note')} maxLength={1000} rows={2} />}</Field>
        {user!.role === 'vet' && <p className="mute">Cet acte sera signé de votre nom.</p>}
        <Footer onClose={onClose} busy={busy} label="Enregistrer" />
      </form>
    </Modal>
  );
}

function MortalityModal({ a, onClose, onDone }: { a: Animal; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(a.kind === 'lot' ? '' : '1');
  const [cause, setCause] = useState('');
  const [on, setOn] = useState(todayIso());
  const [err, setErr] = useState<Record<string, string>>({});
  const { busy, send } = useOp(() => { onDone(); onClose(); });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr({});
    const p: Record<string, unknown> = { animalId: a.id, qty: Number(qty), occurredOn: on };
    if (cause.trim()) p.cause = cause.trim();
    void send('mortality.declare', p, `Mortalité : ${qty} (${a.name})`, 'Mortalité déclarée', setErr);
  };
  return (
    <Modal title="Déclarer une mortalité" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {a.kind === 'lot' && <Field label="Nombre de morts" hint={`Le lot compte ${num(a.qty ?? 0)} têtes.`} error={err.qty}>{(id) => <input id={id} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required inputMode="numeric" />}</Field>}
        <Field label="Cause supposée (facultatif)" error={err.cause}>{(id) => <input id={id} value={cause} onChange={(e) => setCause(e.target.value)} maxLength={200} />}</Field>
        <Field label="Date" error={err.occurredOn}>{(id) => <input id={id} type="date" max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} required />}</Field>
        <Footer onClose={onClose} busy={busy} label="Déclarer" danger />
      </form>
    </Modal>
  );
}

function CaseModal({ a, onClose, onDone }: { a: Animal; onClose: () => void; onDone: () => void }) {
  const [syms, setSyms] = useState<string[]>([]);
  const [diseases, setDiseases] = useState('');
  const [sev, setSev] = useState('moyenne');
  const [count, setCount] = useState('1');
  const [deaths, setDeaths] = useState('0');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const { busy, send } = useOp(() => { onDone(); onClose(); });
  const toggle = (s: string) => setSyms((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr({});
    const list = diseases.split(',').map((d) => d.trim()).filter(Boolean);
    const p: Record<string, unknown> = { animalId: a.id, diseases: list.length ? list : [syms[0] ?? 'à préciser'], affectedCount: Number(count), severity: sev, symptoms: syms, deaths: Number(deaths) };
    if (note.trim()) p.note = note.trim();
    void send('case.create', p, `Cas de maladie (${a.name})`, 'Cas signalé', setErr);
  };
  return (
    <Modal title="Signaler une maladie" onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <fieldset className="symptoms"><legend>Ce que vous observez</legend>
          {SYMPTOMS.map(([s, i]) => <button type="button" key={s} className="chip" aria-pressed={syms.includes(s)} onClick={() => toggle(s)}><span aria-hidden="true">{i}</span> {s}</button>)}
        </fieldset>
        <Field label="Maladie suspectée ou confirmée (facultatif)" hint="Séparez par des virgules. Laissez vide si vous ne savez pas : un vétérinaire pourra préciser." error={err.diseases}>{(id) => <input id={id} value={diseases} onChange={(e) => setDiseases(e.target.value)} placeholder="peste porcine africaine" />}</Field>
        <Field label="Gravité">{(id) => <select id={id} value={sev} onChange={(e) => setSev(e.target.value)}>{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
        <Field label="Têtes touchées" error={err.affectedCount}>{(id) => <input id={id} type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} required inputMode="numeric" />}</Field>
        <Field label="Morts déjà constatées" error={err.deaths}>{(id) => <input id={id} type="number" min={0} value={deaths} onChange={(e) => setDeaths(e.target.value)} inputMode="numeric" />}</Field>
        <Field label="Note (facultatif)" error={err.note}>{(id) => <textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}</Field>
        <Footer onClose={onClose} busy={busy} label="Signaler" />
      </form>
    </Modal>
  );
}

function FlowModal({ a, kind, onClose, onDone }: { a: Animal; kind: 'sale' | 'slaughter' | 'transfer'; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [who, setWho] = useState('');
  const [on, setOn] = useState(todayIso());
  const [found, setFound] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const { send, busy: busyOp } = useOp(() => { onDone(); onClose(); });
  const title = kind === 'sale' ? 'Déclarer une vente' : kind === 'slaughter' ? 'Déclarer un abattage' : 'Transférer à un autre éleveur';

  const lookup = async () => {
    const r = await run(() => api.get<{ id: string; name: string; zone: string | null }>(`/eleveurs/lookup?phone=${encodeURIComponent(who.replace(/\s+/g, ''))}`));
    if (r) setFound(r); else setFound(null);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr({});
    const q = qty ? { qty: Number(qty) } : {};
    if (kind === 'sale') {
      const p: Record<string, unknown> = { animalId: a.id, occurredOn: on, ...q };
      if (price) p.price = Number(price);
      if (found) p.buyerId = found.id; else if (who.trim()) p.counterpart = who.trim();
      await send('sale', p, `Vente (${a.name})`, 'Vente enregistrée', setErr);
    } else if (kind === 'slaughter') {
      const r = await run(() => api.post(`/animals/${a.id}/slaughter`, { occurredOn: on, ...q }), 'Abattage enregistré');
      if (r) { onDone(); onClose(); }
    } else {
      if (!found) { toast('Cherchez d\'abord le destinataire par son téléphone.', 'err'); return; }
      const r = await run(() => api.post(`/animals/${a.id}/transfer`, { toUserId: found.id, occurredOn: on }), 'Fiche transférée');
      if (r) { onDone(); navigate('/animaux'); }
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {kind === 'transfer' && <p className="banner warn">Après le transfert, la fiche et son historique appartiennent au destinataire.</p>}
        {a.kind === 'lot' && kind !== 'transfer' && <Field label="Nombre de têtes" hint={`Vide = tout le lot (${num(a.qty ?? 0)}).`} error={err.qty}>{(id) => <input id={id} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />}</Field>}
        {kind === 'sale' && <Field label="Prix total en FCFA (facultatif)" error={err.price}>{(id) => <input id={id} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" />}</Field>}
        {kind !== 'slaughter' && (
          <Field label={kind === 'sale' ? 'Acheteur (nom, ou téléphone s\'il a un compte)' : 'Téléphone du destinataire'} error={err.buyerId ?? err.toUserId}>
            {(id) => (
              <div className="inline">
                <input id={id} value={who} onChange={(e) => { setWho(e.target.value); setFound(null); }} inputMode={kind === 'transfer' ? 'tel' : 'text'} />
                <button type="button" className="btn" onClick={lookup} disabled={busy || who.replace(/\D/g, '').length < 8}>Chercher</button>
              </div>
            )}
          </Field>
        )}
        {found && <p className="banner ok" role="status">Compte trouvé : <b>{found.name}</b></p>}
        <Field label="Date" error={err.occurredOn}>{(id) => <input id={id} type="date" max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} required />}</Field>
        <Footer onClose={onClose} busy={busy || busyOp} label="Confirmer" danger={kind !== 'sale'} />
      </form>
    </Modal>
  );
}

function SimpleActionModal({ a, kind, onClose, onDone }: { a: Animal; kind: 'theft' | 'recovery'; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const { busy: busyOp, send } = useOp(() => { onDone(); onClose(); });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kind === 'theft') await send('theft.declare', { animalId: a.id, ...(note.trim() ? { note: note.trim() } : {}) }, `Vol déclaré (${a.name})`, 'Vol déclaré : les alertes sont parties');
    else { const r = await run(() => api.post(`/animals/${a.id}/recovery`, note.trim() ? { note: note.trim() } : {}), 'Animal retrouvé'); if (r) { onDone(); onClose(); } }
  };
  return (
    <Modal title={kind === 'theft' ? 'Déclarer un vol' : 'Animal retrouvé'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className={`banner ${kind === 'theft' ? 'warn' : 'ok'}`}>{kind === 'theft' ? 'La fiche sera bloquée et une alerte envoyée aux agents de votre zone.' : 'La fiche sera débloquée et l\'alerte levée.'}</p>
        <Field label="Précisions (facultatif)">{(id) => <textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
        <Footer onClose={onClose} busy={busy || busyOp} label={kind === 'theft' ? 'Déclarer le vol' : 'Confirmer'} danger={kind === 'theft'} />
      </form>
    </Modal>
  );
}

function ListingModal({ a, onClose, onDone }: { a: Animal; onClose: () => void; onDone: () => void }) {
  const isLot = a.kind === 'lot';
  const stock = a.qty ?? 1;
  const cur = a.listing ?? null;
  const [qty, setQty] = useState(String(cur?.qty ?? stock));
  const [price, setPrice] = useState(cur ? String(cur.price) : '');
  const [bulk, setBulk] = useState(!!cur?.bulkMinQty);
  const [minQty, setMinQty] = useState(cur?.bulkMinQty ? String(cur.bulkMinQty) : '');
  const [bulkPrice, setBulkPrice] = useState(cur?.bulkPrice != null ? String(cur.bulkPrice) : '');
  const { busy, run } = useAction();
  const q = Math.floor(Number(qty) || 0), p = Number(price) || 0, mq = Math.floor(Number(minQty) || 0), bp = Number(bulkPrice);
  const errs: Record<string, string> = {};
  if (isLot && (q < 1 || q > stock)) errs.qty = `Entre 1 et ${num(stock)}.`;
  if (bulk && isLot) {
    if (mq < 2 || mq > Math.max(q, 2)) errs.minQty = `Entre 2 et ${num(q)}.`;
    if (bulkPrice === '' || !(bp < p)) errs.bulkPrice = 'Doit être inférieur au prix normal.';
  }
  const bad = Object.keys(errs).length > 0 || price === '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bad) return;
    const body: Record<string, unknown> = { price: p };
    if (isLot) body.qty = q;
    if (bulk && isLot) { body.bulkMinQty = mq; body.bulkPrice = bp; }
    const r = await run(() => api.post(`/animals/${a.id}/listing`, body), cur ? 'Annonce mise à jour' : 'Annonce publiée');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal title={cur ? "Modifier l'annonce" : 'Mettre en vente sur le marché'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {isLot && <Field label={`Combien en mettre en vente ? (lot de ${unitsLabel(a.species, stock)})`} error={errs.qty} hint="Le reste de votre lot n'est pas proposé à la vente.">{(id) => <input id={id} type="number" min={1} max={stock} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required />}</Field>}
        <Field label={isLot ? "Prix à l'unité en FCFA" : 'Prix demandé en FCFA'} hint="Visible par les acheteurs : nom, espèce, zone et prix. Pas votre téléphone.">{(id) => <input id={id} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="numeric" />}</Field>
        {isLot && (
          <>
            <label className="switch"><input type="checkbox" checked={bulk} onChange={(e) => setBulk(e.target.checked)} /> <span><b>Prix réduit à partir d'un certain nombre</b><br /><span className="mute">Pour encourager les achats en gros.</span></span></label>
            {bulk && (
              <div className="grid2">
                <Field label="À partir de combien ?" error={errs.minQty}>{(id) => <input id={id} type="number" min={2} inputMode="numeric" value={minQty} onChange={(e) => setMinQty(e.target.value)} required />}</Field>
                <Field label="Prix réduit à l'unité (FCFA)" error={errs.bulkPrice}>{(id) => <input id={id} type="number" min={0} inputMode="numeric" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} required />}</Field>
              </div>
            )}
          </>
        )}
        {price !== '' && (
          <div className="banner info" role="status" aria-live="polite">
            {isLot ? <>Si tout est vendu : <b>{unitsLabel(a.species, q)} × {fcfa(p)} = {fcfa(q * p)}</b>{bulk && !errs.minQty && !errs.bulkPrice && mq >= 2 && <><br />Dès {num(mq)} : {fcfa(bp)} l'unité, soit {fcfa(mq * bp)} pour {unitsLabel(a.species, mq)}.</>}</> : <>Prix de l'animal : <b>{fcfa(p)}</b></>}
          </div>
        )}
        <div className="actions end"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn pri" disabled={busy || bad}>{busy ? 'Envoi…' : cur ? 'Enregistrer' : "Publier l'annonce"}</button></div>
      </form>
    </Modal>
  );
}

function InviteModal({ a, onClose, onDone }: { a: Animal; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const all = useQuery(() => api.get<{ items: VetSummary[] }>('/vets'), []);
  const needle = q.trim().toLowerCase();
  const vets = { ...all, data: all.data && { items: all.data.items.filter((v) => !needle || `${v.name} ${v.clinic ?? ''} ${v.zone ?? ''}`.toLowerCase().includes(needle)) } };
  const { busy, run } = useAction();
  const invite = async (v: VetSummary) => { const r = await run(() => api.post(`/animals/${a.id}/access`, { vetId: v.id }), `${v.name} a accès pour 30 jours`); if (r) { onDone(); onClose(); } };
  return (
    <Modal title="Donner accès à un vétérinaire" onClose={onClose}>
      <div className="search"><Icon name="search" size={18} /><input type="search" aria-label="Chercher un vétérinaire" placeholder="Nom, clinique, zone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {vets.loading && !vets.data ? <Spinner /> : !vets.data?.items.length ? <Empty icon="user" title="Aucun vétérinaire vérifié trouvé" /> : (
        <ul className="rows">
          {vets.data.items.map((v) => (
            <li key={v.id} className="row">
              <div className="grow"><b>{v.name}</b><br /><span className="mute">{v.clinic ?? 'Cabinet'} · {v.zone ?? '—'} · {phone(v.phone)}</span></div>
              <button className="btn pri" disabled={busy} onClick={() => invite(v)}>Autoriser</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Réduit la photo avant l'envoi (1280 px, JPEG) : une photo de téléphone fait plusieurs Mo, l'envoi doit rester léger en 3G. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Image illisible.');
  return await new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => ko(r.error); r.readAsDataURL(blob); });
}

function PhotoModal({ a, onClose, onDone }: { a: Animal; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const canUpload = a.owner.id === user!.id;
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const { busy, run } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = file
      ? await run(async () => api.post(`/animals/${a.id}/photos/upload`, { contentType: 'image/jpeg', data: await shrink(file) }), 'Photo ajoutée')
      : await run(() => api.post(`/animals/${a.id}/photos`, { url: url.trim() }), 'Photo ajoutée');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal title="Ajouter une photo" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {canUpload && <Field label="Prendre ou choisir une photo" hint="Elle est réduite automatiquement avant l'envoi. Il faut du réseau.">{(id) => <input id={id} type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>}
        {!file && <Field label={canUpload ? 'Ou une adresse de photo (https://…)' : 'Adresse de la photo (https://…)'}>{(id) => <input id={id} type="url" value={url} onChange={(e) => setUrl(e.target.value)} required={!canUpload} placeholder="https://" />}</Field>}
        <Footer onClose={onClose} busy={busy} label="Ajouter" />
      </form>
    </Modal>
  );
}

function EditModal({ a, onClose, onDone }: { a: Animal; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: a.name, breed: a.breed ?? '', avgWeightKg: a.avgWeightKg?.toString() ?? '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const { busy, send } = useOp(() => { onDone(); onClose(); });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr({});
    const p: Record<string, unknown> = { animalId: a.id, baseUpdatedAt: a.updatedAt, name: f.name.trim() };
    if (f.breed.trim()) p.breed = f.breed.trim();
    if (f.avgWeightKg) p.avgWeightKg = Number(f.avgWeightKg);
    void send('animal.update', p, `Modification de ${a.name}`, 'Fiche mise à jour', setErr);
  };
  return (
    <Modal title="Modifier la fiche" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Nom" error={err.name}>{(id) => <input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} />}</Field>
        <Field label="Race" error={err.breed}>{(id) => <input id={id} value={f.breed} onChange={(e) => setF({ ...f, breed: e.target.value })} maxLength={80} />}</Field>
        <Field label="Poids moyen (kg)" error={err.avgWeightKg}>{(id) => <input id={id} type="number" step="0.1" min="0" value={f.avgWeightKg} onChange={(e) => setF({ ...f, avgWeightKg: e.target.value })} inputMode="decimal" />}</Field>
        <Footer onClose={onClose} busy={busy} label="Enregistrer" />
      </form>
    </Modal>
  );
}

export function Timeline({ items, onCorrect }: { items: HealthEvent[]; onCorrect?: (e: HealthEvent) => void }) {
  if (!items.length) return <Empty icon="syringe" title="Aucun acte enregistré">Vaccins, soins et contrôles apparaîtront ici, du plus récent au plus ancien.</Empty>;
  return (
    <ul className="timeline">
      {items.map((e) => (
        <li key={e.id} className={e.correctedBy ? 'struck' : ''}>
          <div className="dot" aria-hidden="true" />
          <div className="grow">
            <b>{e.label}</b> <Badge tone={e.type === 'vaccin' ? 'blue' : e.type === 'soin' ? 'amber' : 'grey'}>{EVENT_TYPE[e.type]}</Badge>
            {e.signedByVet && <Badge tone="green">Signé vétérinaire</Badge>}
            {e.correctedBy && <Badge tone="grey">Corrigé</Badge>}
            {e.correctsEventId && <Badge tone="grey">Correction</Badge>}
            <br /><span className="mute">{date(e.doneOn)} · {e.recordedBy.name}{e.nextDueOn ? ` · rappel le ${date(e.nextDueOn)}` : ''}{e.withdrawalUntil ? ` · délai d'attente jusqu'au ${date(e.withdrawalUntil)}` : ''}</span>
            {e.note && <p className="note">{e.note}</p>}
          </div>
          {onCorrect && !e.correctedBy && <button className="btn sm" onClick={() => onCorrect(e)}>Corriger</button>}
        </li>
      ))}
    </ul>
  );
}

export function AnimalPage({ id }: { id: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const { query } = useLoc();
  const [tab, setTab] = useState<Tab>('resume');
  const [modal, setModal] = useState<ModalName>(null);
  const [correct, setCorrect] = useState<HealthEvent | undefined>();
  const a = useQuery(() => api.get<Animal>(`/animals/${id}`), [id]);
  const summary = useQuery(() => api.get<HealthSummary>(`/animals/${id}/health-summary`), [id]);
  const E0 = { eq: '', etype: '', efrom: '', eto: '', esigned: '', eorder: 'desc' };
  const C0 = { q: '', status: '', from: '', to: '' };
  const M0 = { q: '', type: '', from: '', to: '', order: 'desc' };
  const [ev, setEv] = useState(E0);
  const [cf, setCf] = useState(C0);
  const [mf, setMf] = useState(M0);
  const events = useQuery(() => api.get<{ items: HealthEvent[] }>(`/animals/${id}/health-events${qs({ q: ev.eq, type: ev.etype, from: ev.efrom, to: ev.eto, signed: ev.esigned, order: ev.eorder })}`), [id, ev.eq, ev.etype, ev.efrom, ev.eto, ev.esigned, ev.eorder]);
  const cases = useQuery(() => api.get<{ items: Case[] }>(`/animals/${id}/cases${qs({ ...cf, order: 'desc' })}`), [id, cf.q, cf.status, cf.from, cf.to]);
  const flows = useQuery(() => api.get<{ items: Flow[] }>(`/animals/${id}/flows${qs(mf)}`), [id, mf.q, mf.type, mf.from, mf.to, mf.order]);
  const casesAll = useQuery(() => api.get<{ items: Case[] }>(`/animals/${id}/cases`), [id]);
  const grants = useQuery(() => api.get<{ items: Grant[] }>(`/animals/${id}/access`), [id]);
  const { busy, run } = useAction();

  const reload = () => { a.reload(); summary.reload(); events.reload(); cases.reload(); casesAll.reload(); flows.reload(); grants.reload(); };

  const wanted = query.get('do');
  useEffect(() => {
    if (!a.data) return;
    if (wanted === 'case' || wanted === 'maladie') setModal('case');
    else if (wanted === 'event') setModal('event');
    else if (wanted === 'mortalite') setModal('mortalite');
    if (wanted) navigate(`/animaux/${id}`, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.data?.id, wanted]);

  // Un ancien propriétaire n'a plus accès à la fiche (404) : s'il l'a eue, on l'envoie vers son dossier archivé.
  const gone = a.error instanceof ApiError && a.error.status === 404 && user!.role === 'eleveur';
  const arch = useQuery(() => (gone ? api.get<{ animal: { id: string } }>(`/animals/${id}/archive`) : Promise.resolve(null)), [id, gone]);
  useEffect(() => { if (arch.data) navigate(`/archives/${id}`, true); }, [arch.data, id]);
  if (a.loading && !a.data) return <Spinner />;
  if (gone && (arch.loading || arch.data)) return <Spinner />;
  if (a.error || !a.data) return <ErrorBox error={a.error} retry={a.reload} />;
  const an = a.data;
  const isOwner = (user!.role === 'eleveur' || user!.role === 'particulier') && an.owner.id === user!.id;
  const isVet = user!.role === 'vet';
  const locked = an.status !== 'actif';
  const stolen = an.status === 'vole';
  const canRecord = (isOwner || isVet) && !stolen && an.status === 'actif';
  const onSale = false;
  const close = () => { setModal(null); setCorrect(undefined); };

  const unlist = async () => { const r = await run(() => api.del(`/animals/${id}/listing`), 'Annonce retirée'); if (r !== undefined) reload(); };
  const revoke = async (g: Grant) => { const r = await run(() => api.del(`/animals/${id}/access/${g.vetId}`), 'Accès retiré'); if (r !== undefined) reload(); };
  const rmPhoto = async (pid: string) => { const r = await run(() => api.del(`/animals/${id}/photos/${pid}`), 'Photo retirée'); if (r !== undefined) reload(); };
  const closeCase = async (c: Case, status: 'suivi' | 'gueri' | 'clos') => {
    const r = await run(() => submitOp('case.update', { caseId: c.id, status }, `Cas ${CASE_STATUS[status]}`));
    if (r) { toast(r.queued ? 'Mise à jour en attente de réseau.' : 'Cas mis à jour', r.queued ? 'info' : 'ok'); cases.reload(); casesAll.reload(); }
  };

  const tabs: [Tab, string][] = [['resume', 'Résumé'], ['sante', 'Santé'], ['mouvements', 'Mouvements'], ['acces', 'Accès'], ['photos', 'Photos']];
  const s = summary.data;
  const openCases = casesAll.data?.items.filter((c) => c.status === 'ouvert' || c.status === 'suivi') ?? [];

  const act = (label: string, name: ModalName, cls = '', icon = 'plus'): ReactNode => <button className={`btn ${cls}`} onClick={() => setModal(name)}><Icon name={icon} size={18} /> {label}</button>;

  return (
    <>
      <button className="link back" onClick={back}><Icon name="back" size={18} /> Retour</button>
      <header className="animal-head card">
        <div className="ico big" aria-hidden="true">{SPECIES[an.species].icon}</div>
        <div className="grow">
          <h1>{an.name}</h1>
          <p className="mute">{SPECIES[an.species].label}{an.breed ? ` · ${an.breed}` : ''}{an.sex ? ` · ${an.sex === 'F' ? 'femelle' : 'mâle'}` : ''} · {headcount(an)}</p>
          <p><Badge tone={STATUS[an.status].tone}>{STATUS[an.status].label}</Badge> <span className="mono">{an.code}</span> · {an.zone.name}{!isOwner && ` · ${an.owner.name}`}</p>
          {an.bornOn && <p className="mute">Né le {date(an.bornOn)}</p>}
        </div>
        <QrCode text={an.code} size={120} />
      </header>
      <div className="actions" style={{ marginBottom: '.8rem' }}>
        <Link to={`/imprimer/carnet/${an.id}`} className="btn sm"><Icon name="download" size={16} /> Carnet imprimable (PDF)</Link>
        {isOwner && an.status === 'vendu' && <Link to={`/imprimer/certificat/${an.id}`} className="btn sm">Certificat de vente</Link>}
      </div>

      {stolen && <div className="banner err" role="alert"><b>Animal déclaré volé.</b> La fiche est bloquée.{isOwner && ' Si vous l\'avez retrouvé, déclarez-le.'}</div>}
      {an.status !== 'actif' && !stolen && <div className="banner info">Cette fiche est clôturée ({STATUS[an.status].label.toLowerCase()}). Elle reste consultable.</div>}
      {s && !s.canSell && an.status === 'actif' && <div className="banner warn" role="alert"><b>Délai d'attente jusqu'au {date(s.withdrawalUntil)}.</b> Vente et abattage impossibles avant cette date.</div>}

      {(canRecord || isOwner) && (
        <div className="toolbar" role="toolbar" aria-label="Actions">
          {canRecord && act('Acte de santé', 'event', 'pri', 'syringe')}
          {canRecord && act('Signaler une maladie', 'case', '', 'alert')}
          {isOwner && canRecord && act('Mortalité', 'mortalite', '', 'skull')}
          {isOwner && !locked && act('Vente', 'sale', '', 'coin')}
          {isOwner && !locked && act('Abattage', 'slaughter', '', 'knife')}
          {isOwner && !locked && act('Transférer', 'transfer', '', 'swap')}
          {isOwner && !locked && act('Modifier', 'edit', '', 'edit')}
          {isOwner && !locked && act('Déclarer un vol', 'theft', 'danger', 'alert')}
          {isOwner && stolen && act('Retrouvé', 'recovery', 'pri', 'check')}
        </div>
      )}

      <div className="tabs" role="tablist">
        {tabs.filter(([t]) => t !== 'acces' || isOwner || isVet).map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>)}
      </div>

      {tab === 'resume' && (
        <div className="grid2">
          <Card title="Santé en bref">
            {!s ? <Spinner /> : (
              <ul className="plain">
                <li>Vente possible : {s.canSell ? <Badge tone="green">Oui</Badge> : <Badge tone="red">Non, jusqu'au {date(s.withdrawalUntil)}</Badge>}</li>
                <li>Dernier acte : {s.lastEvent ? `${s.lastEvent.label} (${date(s.lastEvent.doneOn)})` : 'aucun'}</li>
                <li>Rappels : {s.upcoming.length ? s.upcoming.map((u) => <div key={u.label + u.nextDueOn}>{u.overdue ? <Badge tone="red">En retard</Badge> : <Badge tone="blue">À venir</Badge>} {u.label} · {date(u.nextDueOn)}</div>) : 'aucun'}</li>
              </ul>
            )}
          </Card>
          <Card title="Cas en cours">
            {!openCases.length ? <p className="mute">Aucun cas ouvert.</p> : (
              <ul className="plain">{openCases.map((c) => <li key={c.id}><b>{c.diseases.join(', ')}</b> {c.notifiable && <Badge tone="red">À déclaration obligatoire</Badge>}<br /><span className="mute">{SEVERITY[c.severity]} · {c.affectedCount} touché(s) · depuis le {date(c.openedOn)}</span></li>)}</ul>
            )}
          </Card>
          <Card title="Identification">
            <ul className="plain"><li>Code : <span className="mono">{an.code}</span></li>{an.rfid && <li>Boucle RFID : <span className="mono">{an.rfid}</span></li>}{an.avgWeightKg != null && <li>Poids moyen : {an.avgWeightKg} kg</li>}<li>Créée le {date(an.createdAt)}</li></ul>
          </Card>
          {isOwner && an.status === 'actif' && (
            <Card title="Marché">
              {an.listing
                ? <p>En vente : <b>{an.kind === 'lot' ? `${unitsLabel(an.species, an.listing.qty)} à ${fcfa(an.listing.price)} l'unité` : fcfa(an.listing.price)}</b>{an.listing.bulkMinQty != null && an.listing.bulkPrice != null && <><br /><span className="mute">{fcfa(an.listing.bulkPrice)} l'unité dès {num(an.listing.bulkMinQty)} achetés</span></>}</p>
                : <p className="mute">Publiez une annonce pour être contacté par des acheteurs.</p>}
              <div className="actions">{act(an.listing ? "Modifier l'annonce" : 'Mettre en vente', 'listing', '', 'coin')}{an.listing && <button className="btn" disabled={busy} onClick={unlist}>Retirer l'annonce</button>}</div>
            </Card>
          )}
          {onSale}
        </div>
      )}

      {tab === 'sante' && (
        <>
          <div className="filters">
            <SearchBox value={ev.eq} onChange={(eq) => setEv((x) => ({ ...x, eq }))} placeholder="Chercher un acte, une note, un nom…" />
            <select aria-label="Type d'acte" value={ev.etype} onChange={(e) => setEv({ ...ev, etype: e.target.value })}>
              <option value="">Tous les actes</option>{Object.entries(EVENT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select aria-label="Signature" value={ev.esigned} onChange={(e) => setEv({ ...ev, esigned: e.target.value })}>
              <option value="">Signés ou non</option><option value="true">Signés par un vétérinaire</option><option value="false">Non signés</option>
            </select>
            <select aria-label="Trier" value={ev.eorder} onChange={(e) => setEv({ ...ev, eorder: e.target.value })}>
              <option value="desc">Plus récents d'abord</option><option value="asc">Plus anciens d'abord</option>
            </select>
            <DateRange from={ev.efrom} to={ev.eto} onChange={(efrom, eto) => setEv({ ...ev, efrom, eto })} />
            <ResetFilters count={JSON.stringify(ev) === JSON.stringify(E0) ? 0 : 1} onReset={() => setEv(E0)} />
          </div>
          <Card title="Historique de santé"><Timeline items={events.data?.items ?? []} onCorrect={canRecord ? (e) => { setCorrect(e); setModal('event'); } : undefined} /></Card>
          <Card title="Cas de maladie">
            <div className="filters">
              <SearchBox value={cf.q} onChange={(q) => setCf((x) => ({ ...x, q }))} placeholder="Maladie, symptôme, note…" label="Rechercher un cas" />
              <select aria-label="État du cas" value={cf.status} onChange={(e) => setCf({ ...cf, status: e.target.value })}>
                <option value="">Tous les états</option>{Object.entries(CASE_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <DateRange label="Cas ouverts" from={cf.from} to={cf.to} onChange={(from, to) => setCf({ ...cf, from, to })} />
            </div>
            {!cases.data?.items.length ? <p className="mute">Aucun cas{JSON.stringify(cf) === JSON.stringify(C0) ? ' signalé' : ' avec ces filtres'}.</p> : (
              <ul className="rows">
                {cases.data.items.map((c) => (
                  <li key={c.id} className="row">
                    <div className="grow"><b>{c.diseases.join(', ')}</b> <Badge tone={c.severity === 'grave' ? 'red' : c.severity === 'moyenne' ? 'amber' : 'grey'}>{SEVERITY[c.severity]}</Badge> <Badge tone={c.status === 'ouvert' ? 'amber' : 'green'}>{CASE_STATUS[c.status]}</Badge>{c.notifiable && <Badge tone="red">Déclaration obligatoire</Badge>}<br /><span className="mute">{date(c.openedOn)} · {c.affectedCount} touché(s) · {c.deaths} mort(s){c.symptoms.length ? ` · ${c.symptoms.join(', ')}` : ''}</span></div>
                    {(isVet || isOwner) && (c.status === 'ouvert' || c.status === 'suivi') && (
                      <div className="actions">
                        {c.status === 'ouvert' && <button className="btn sm" onClick={() => closeCase(c, 'suivi')}>Suivi</button>}
                        <button className="btn sm" onClick={() => closeCase(c, 'gueri')}>Guéri</button>
                        <button className="btn sm" onClick={() => closeCase(c, 'clos')}>Clore</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {tab === 'mouvements' && (
        <Card title="Mouvements">
          <div className="filters">
            <SearchBox value={mf.q} onChange={(q) => setMf((x) => ({ ...x, q }))} placeholder="Acheteur, note…" label="Rechercher un mouvement" />
            <select aria-label="Type de mouvement" value={mf.type} onChange={(e) => setMf({ ...mf, type: e.target.value })}>
              <option value="">Tous les mouvements</option>{Object.entries(FLOW_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select aria-label="Trier" value={mf.order} onChange={(e) => setMf({ ...mf, order: e.target.value })}>
              <option value="desc">Plus récents d'abord</option><option value="asc">Plus anciens d'abord</option>
            </select>
            <DateRange from={mf.from} to={mf.to} onChange={(from, to) => setMf({ ...mf, from, to })} />
          </div>
          {!flows.data?.items.length ? <Empty icon="swap" title="Aucun mouvement" /> : (
            <ul className="rows">{flows.data.items.map((f) => <li key={f.id} className="row"><div className="grow"><b>{FLOW_LABEL[f.type] ?? f.type}</b>{f.qty != null && ` · ${f.qty}`}{f.counterpart && ` · ${f.counterpart}`}<br /><span className="mute">{date(f.occurredOn)} · {f.recordedBy.name}{f.note ? ` · ${f.note}` : ''}</span></div></li>)}</ul>
          )}
        </Card>
      )}

      {tab === 'acces' && (
        <Card title="Vétérinaires autorisés" actions={isOwner && !locked ? <button className="btn sm pri" onClick={() => setModal('invite')}>Autoriser un vétérinaire</button> : undefined}>
          <p className="mute">Un accès dure 30 jours et se renouvelle à chaque soin. Vous pouvez le retirer à tout moment.</p>
          {!grants.data?.items.length ? <p>Aucun accès.</p> : (
            <ul className="rows">{grants.data.items.map((g) => <li key={g.vetId + g.grantedOn} className="row"><div className="grow"><b>{g.vetName}</b> {g.active ? <Badge tone="green">Actif</Badge> : <Badge tone="grey">{g.revokedOn ? 'Retiré' : 'Expiré'}</Badge>}<br /><span className="mute">depuis le {date(g.grantedOn)} · jusqu'au {date(g.expiresOn)} · via {g.source}</span></div>{isOwner && g.active && <button className="btn sm" disabled={busy} onClick={() => revoke(g)}>Retirer</button>}</li>)}</ul>
          )}
        </Card>
      )}

      {tab === 'photos' && (
        <Card title="Photos" actions={(isOwner || isVet) && !locked ? <button className="btn sm pri" onClick={() => setModal('photo')}>Ajouter</button> : undefined}>
          {!an.photos.length ? <Empty icon="image" title="Aucune photo" /> : (
            <div className="photos">{an.photos.map((p) => <figure key={p.id}><img src={photoSrc(p.url)} alt={`Photo de ${an.name}`} loading="lazy" />{isOwner && <button className="btn sm" onClick={() => rmPhoto(p.id)}>Retirer</button>}</figure>)}</div>
          )}
        </Card>
      )}

      {modal === 'event' && <EventModal a={an} onClose={close} onDone={reload} correct={correct} />}
      {modal === 'mortalite' && <MortalityModal a={an} onClose={close} onDone={reload} />}
      {modal === 'case' && <CaseModal a={an} onClose={close} onDone={reload} />}
      {(modal === 'sale' || modal === 'slaughter' || modal === 'transfer') && <FlowModal a={an} kind={modal} onClose={close} onDone={reload} />}
      {(modal === 'theft' || modal === 'recovery') && <SimpleActionModal a={an} kind={modal} onClose={close} onDone={reload} />}
      {modal === 'listing' && <ListingModal a={an} onClose={close} onDone={reload} />}
      {modal === 'invite' && <InviteModal a={an} onClose={close} onDone={reload} />}
      {modal === 'photo' && <PhotoModal a={an} onClose={close} onDone={reload} />}
      {modal === 'edit' && <EditModal a={an} onClose={close} onDone={reload} />}
    </>
  );
}
