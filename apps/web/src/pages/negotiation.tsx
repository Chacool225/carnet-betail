import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ChatMessage, RequestDetail } from '../api/types';
import { Badge, ErrorBox, Field, Modal, Spinner, useAction, useQuery } from '../ui/kit';
import { Link } from '../lib/router';
import { ORG_KIND, REQUEST_STATUS, SPECIES, dateTime, fcfa, num, phone, unitPriceFor, unitsLabel } from '../lib/format';

const line = (species: RequestDetail['animal']['species'], p: { qty: number; unitPrice: number }) =>
  `${unitsLabel(species, p.qty)} × ${fcfa(p.unitPrice)} = ${fcfa(p.qty * p.unitPrice)}`;

/**
 * Fenêtre de discussion d'une demande d'achat : conversation, propositions de chaque partie (quantité et prix à l'unité),
 * accord, puis conclusion de la vente par l'éleveur. Quand les deux saisissent la même quantité et le même prix,
 * l'accord est conclu et un récapitulatif est posté dans la conversation.
 */
export function NegotiationModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useQuery(() => api.get<RequestDetail>(`/purchase-requests/${id}`), [id]);
  const msgs = useQuery(() => api.get<{ items: ChatMessage[] }>(`/purchase-requests/${id}/messages`), [id]);
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const r = detail.data;

  // Actualise la conversation toute seule tant que la fenêtre est ouverte.
  useEffect(() => {
    const t = setInterval(() => { detail.reload(); msgs.reload(); }, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Les champs partent de la dernière proposition connue ; ils ne bougent plus dès que la personne tape.
  useEffect(() => {
    if (!r || touched) return;
    const p = r.mine ?? r.theirs;
    setQty(String(p?.qty ?? r.qty));
    setUnit(String(p?.unitPrice ?? r.offeredPrice ?? r.listingPrice ?? ''));
  }, [r?.id, r?.mine?.qty, r?.mine?.unitPrice, r?.theirs?.qty, r?.theirs?.unitPrice, touched]);
  const count = msgs.data?.items.length ?? 0;
  useEffect(() => { chatRef.current?.scrollTo?.({ top: chatRef.current.scrollHeight }); }, [count]);

  if (detail.error && !r) return <Modal title="Demande d'achat" onClose={onClose}><ErrorBox error={detail.error} retry={detail.reload} /></Modal>;
  if (!r) return <Modal title="Demande d'achat" onClose={onClose}><Spinner /></Modal>;

  const st = REQUEST_STATUS[r.status]!;
  const open = r.status === 'en_attente' || r.status === 'acceptee';
  const isLot = r.animal.kind === 'lot';
  const seller = r.side === 'seller';
  const q = Math.floor(Number(qty) || 0), u = Number(unit);
  const max = r.availableQty ?? 0;
  const qErr = isLot && (q < 1 || (r.availableQty != null && q > max)) ? `Entre 1 et ${num(max)}.` : '';
  const tier = { price: r.listingPrice ?? 0, bulkMinQty: r.bulkMinQty, bulkPrice: r.bulkPrice };
  const refresh = () => { detail.reload(); msgs.reload(); onChanged(); };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await run(() => api.post(`/purchase-requests/${id}/messages`, { body: text.trim() }));
    if (res) { setText(''); refresh(); }
  };
  const propose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (qErr || unit === '' || !(u >= 0)) return;
    const res = await run(() => api.post<{ agreed: boolean }>(`/purchase-requests/${id}/proposal`, { qty: isLot ? q : 1, unitPrice: u }));
    if (res) { setTouched(false); refresh(); }
  };
  const act = async (what: 'refuse' | 'cancel' | 'complete', msg: string) => {
    const res = await run(() => api.post(`/purchase-requests/${id}/${what}`, {}), msg);
    if (res !== undefined) { setConfirm(false); refresh(); }
  };
  const adopt = () => { if (r.theirs) { setQty(String(r.theirs.qty)); setUnit(String(r.theirs.unitPrice)); setTouched(true); } };

  const stock = r.animal.qty ?? 1;
  const partial = isLot && r.agreedQty != null && r.agreedQty < stock;
  const bp = r.buyerProfile;

  return (
    <Modal title={`${r.animal.name} · ${r.animal.code}`} onClose={onClose} wide>
      <p style={{ marginTop: 0 }}><Badge tone={st.tone}>{st.label}</Badge> <span className="mute">{seller ? 'Acheteur' : 'Vendeur'} : <b>{r.other.name}</b> · demande du {dateTime(r.createdAt)}</span></p>
      {bp && (
        <div className="who">
          <b>{bp.orgName ? `${ORG_KIND[bp.orgKind ?? 'autre'] ?? 'Organisation'} ${bp.orgName}` : 'Particulier'}</b>
          {bp.profession && ` · ${bp.profession}`}{bp.locality && ` · ${bp.locality}`}
          {bp.contactName && <><br />Responsable : {bp.contactName}{bp.contactPhone && <> · <a href={`tel:${bp.contactPhone}`}><b>{phone(bp.contactPhone)}</b></a></>}</>}
        </div>
      )}
      {r.listingPrice != null && <p className="mute">Annonce : {fcfa(r.listingPrice)}{isLot && " l'unité"}{r.bulkMinQty != null && r.bulkPrice != null && ` · ${fcfa(r.bulkPrice)} dès ${num(r.bulkMinQty)}`}{isLot && r.availableQty != null && ` · ${unitsLabel(r.animal.species, r.availableQty)} disponibles`}</p>}
      {r.other.phone && <p>Téléphone de {r.other.name} : <a href={`tel:${r.other.phone}`}><b>{phone(r.other.phone)}</b></a></p>}

      <div className="chat" ref={chatRef} role="log" aria-label="Conversation" aria-live="polite">
        {msgs.data?.items.map((m) => m.kind === 'recap'
          ? <div key={m.id} className="msg recap"><b>✅ {m.body.split('\n')[0]}</b>{'\n' + m.body.split('\n').slice(1).join('\n')}</div>
          : m.kind === 'system'
            ? <div key={m.id} className="msg sys">{m.body}</div>
            : <div key={m.id} className={`msg ${m.mine ? 'mine' : ''} ${m.kind === 'proposal' ? 'prop' : ''}`}>
                <small>{m.mine ? 'Vous' : m.senderName} · {dateTime(m.createdAt)}</small>
                {m.kind === 'proposal' && m.qty != null && m.unitPrice != null ? <><b>Proposition</b> : {line(r.animal.species, { qty: m.qty, unitPrice: m.unitPrice })}</> : m.body}
              </div>)}
        {msgs.loading && !msgs.data && <Spinner />}
      </div>

      {r.status === 'en_attente' && (
        <form className="form" onSubmit={propose} aria-label="Accord sur la quantité et le prix">
          <div className="deal">
            <div><h4>Votre proposition</h4>{r.mine ? line(r.animal.species, r.mine) : <span className="mute">Pas encore saisie</span>}</div>
            <div><h4>Proposition de {r.other.name}</h4>{r.theirs ? line(r.animal.species, r.theirs) : <span className="mute">Pas encore saisie</span>}</div>
          </div>
          <div className={isLot ? 'dealform' : ''}>
            {isLot && <Field label="Quantité" error={qErr}>{(fid) => <input id={fid} type="number" min={1} max={max || undefined} inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setTouched(true); }} required />}</Field>}
            <Field label="Prix à l'unité (FCFA)" hint={isLot && q >= 1 ? `Prix de l'annonce pour ${num(q)} : ${fcfa(unitPriceFor(tier, q))}` : undefined}>{(fid) => <input id={fid} type="number" min={0} inputMode="numeric" value={unit} onChange={(e) => { setUnit(e.target.value); setTouched(true); }} required />}</Field>
          </div>
          <div className="banner info" role="status" aria-live="polite">Total : <b>{fcfa((isLot ? Math.max(q, 0) : 1) * (u || 0))}</b>. Quand vous saisissez tous les deux la même quantité et le même prix, l'accord est conclu et un récapitulatif est envoyé dans la conversation.</div>
          <div className="actions">
            <button className="btn pri" disabled={busy || !!qErr || unit === ''}>Valider mon accord</button>
            {r.theirs && (r.theirs.qty !== q || r.theirs.unitPrice !== u) && <button type="button" className="btn" onClick={adopt}>Reprendre sa proposition</button>}
            {seller ? <button type="button" className="btn" disabled={busy} onClick={() => act('refuse', 'Demande refusée')}>Refuser la demande</button>
              : <button type="button" className="btn" disabled={busy} onClick={() => act('cancel', 'Demande annulée')}>Annuler ma demande</button>}
          </div>
        </form>
      )}

      {r.status === 'acceptee' && (
        <div className="stack">
          <div className="banner ok">Accord conclu : <b>{line(r.animal.species, { qty: r.agreedQty ?? 1, unitPrice: r.agreedPrice ?? 0 })}</b>. Le paiement et la remise se font directement entre vous.</div>
          {seller && !confirm && <div className="actions"><button className="btn pri" disabled={busy} onClick={() => setConfirm(true)}>Les animaux ont été remis : conclure la vente</button></div>}
          {seller && confirm && (
            <div className="banner warn">
              <p style={{ marginTop: 0 }}>{partial
                ? <>Vous vendez <b>{unitsLabel(r.animal.species, r.agreedQty!)}</b> sur {num(stock)}. Un nouveau lot, avec les vaccins déjà enregistrés, sera créé sur le compte de <b>{r.other.name}</b>. Il vous restera {unitsLabel(r.animal.species, stock - r.agreedQty!)}.</>
                : <>La fiche, avec tout son carnet de santé, passera sur le compte de <b>{r.other.name}</b>. Vous garderez le dossier en lecture seule.</>} Cette action ne peut pas être annulée.</p>
              <div className="actions"><button className="btn" onClick={() => setConfirm(false)}>Pas encore</button><button className="btn pri" disabled={busy} onClick={() => act('complete', 'Vente conclue')}>Conclure la vente</button></div>
            </div>
          )}
          {!seller && <div className="actions"><button className="btn" disabled={busy} onClick={() => act('cancel', 'Demande annulée')}>Annuler ma demande</button></div>}
        </div>
      )}

      {r.status === 'conclue' && (
        <div className="banner ok">Vente conclue : <b>{line(r.animal.species, { qty: r.agreedQty ?? 1, unitPrice: r.agreedPrice ?? 0 })}</b>. {seller ? <Link to={`/imprimer/certificat/${r.animal.id}`}>Certificat de vente</Link> : <Link to="/animaux">Voir mes animaux</Link>}</div>
      )}

      {open
        ? <form className="chatform" onSubmit={send}><input aria-label="Votre message" placeholder="Écrire un message…" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} /><button className="btn" disabled={busy || !text.trim()}>Envoyer</button></form>
        : <p className="mute">La conversation est fermée.</p>}
      <p className="mute" style={{ marginBottom: 0 }}>{SPECIES[r.animal.species].icon} Les téléphones ne sont partagés qu'après l'accord.</p>
    </Modal>
  );
}
