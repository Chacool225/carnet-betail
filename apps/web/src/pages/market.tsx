import { useState } from 'react';
import { api, photoSrc, qs } from '../api/client';
import type { MarketItem, MarketSheet, Page, Zone } from '../api/types';
import { Badge, Card, Empty, ErrorBox, Field, Icon, Modal, PageHead, Pager, Spinner, useAction, useQuery } from '../ui/kit';
import { DateRange, MoreFilters, ResetFilters, SearchBox, useUrlFilters } from '../ui/filters';
import { useAuth } from '../ui/auth';
import { Link, back, navigate } from '../lib/router';
import { REQUEST_STATUS, SPECIES, SPECIES_LIST, date, fcfa, num, unitPriceFor, unitsLabel } from '../lib/format';

const forSale = (m: { kind: string; species: MarketItem['species']; qty: number | null; listingQty: number | null }) =>
  m.kind === 'lot' ? `${unitsLabel(m.species, m.listingQty ?? m.qty ?? 0)} à vendre` : '1 animal';

export function MarketPage() {
  const { user } = useAuth();
  const f = useUrlFilters({ q: '', species: '', zoneId: '', sort: 'listed:desc', minPrice: '', maxPrice: '' });
  const v = f.values;
  const zones = useQuery(() => api.get<{ items: Zone[] }>('/zones'), []);
  const [s, o] = v.sort.split(':');
  const list = useQuery(() => api.get<Page<MarketItem>>(`/market${qs({ q: v.q, species: v.species, zoneId: v.zoneId, minPrice: v.minPrice, maxPrice: v.maxPrice, sort: s, order: o, page: f.page, limit: 20 })}`), [v.q, v.species, v.zoneId, v.sort, v.minPrice, v.maxPrice, f.page]);
  return (
    <>
      <PageHead title="Marché" sub={list.data ? `${list.data.total} annonce(s)` : undefined}>
        <Link to="/demandes" className="btn">{user!.role === 'particulier' ? 'Mes demandes' : "Demandes d'achat"}</Link>
      </PageHead>
      <div className="filters">
        <SearchBox value={v.q} onChange={(q) => f.set({ q })} placeholder="Espèce, race, nom…" />
        <select aria-label="Espèce" value={v.species} onChange={(e) => f.set({ species: e.target.value })}><option value="">Toutes les espèces</option>{SPECIES_LIST.map((x) => <option key={x} value={x}>{SPECIES[x].label}</option>)}</select>
        <select aria-label="Zone" value={v.zoneId} onChange={(e) => f.set({ zoneId: e.target.value })}><option value="">Toutes les zones</option>{zones.data?.items.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
        <select aria-label="Trier" value={v.sort} onChange={(e) => f.set({ sort: e.target.value })}><option value="listed:desc">Plus récentes</option><option value="listed:asc">Plus anciennes</option><option value="price:asc">Prix croissant</option><option value="price:desc">Prix décroissant</option></select>
      </div>
      <MoreFilters count={f.active(['q', 'species', 'zoneId', 'sort'])}>
        <Field label="Prix minimum (FCFA)">{(id) => <input id={id} type="number" min={0} inputMode="numeric" value={v.minPrice} onChange={(e) => f.set({ minPrice: e.target.value })} />}</Field>
        <Field label="Prix maximum (FCFA)">{(id) => <input id={id} type="number" min={0} inputMode="numeric" value={v.maxPrice} onChange={(e) => f.set({ maxPrice: e.target.value })} />}</Field>
      </MoreFilters>
      <div className="filterbar"><ResetFilters count={f.active(['sort'])} onReset={f.reset} /></div>
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox error={list.error} retry={list.reload} /> : (
        <Card>
          {!list.data?.items.length ? <Empty icon="shop" title="Aucune annonce">Les animaux sans délai d'attente, mis en vente par leur éleveur, apparaissent ici.</Empty> : (
            <ul className="rows">
              {list.data.items.map((m) => (
                <li key={m.id}>
                  <Link to={`/marche/${m.id}`} className="row">
                    {m.photoUrl ? <img className="thumb" src={photoSrc(m.photoUrl)} alt="" loading="lazy" /> : <span className="ico" aria-hidden="true">{SPECIES[m.species].icon}</span>}
                    <div className="grow"><b>{m.name}</b>{m.breed && ` · ${m.breed}`}<br /><span className="mute">{forSale(m)} · {m.zone} · {m.ownerName} · publiée le {date(m.listedAt)}</span></div>
                    <div className="pricecol"><b className="price">{fcfa(m.price)}{m.kind === 'lot' && <small> / unité</small>}</b>{m.bulkMinQty != null && m.bulkPrice != null && <small className="mute">{fcfa(m.bulkPrice)} dès {num(m.bulkMinQty)}</small>}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {list.data && <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={f.setPage} />}
        </Card>
      )}
    </>
  );
}

export function MarketDetailPage({ id }: { id: string }) {
  const sheet = useQuery(() => api.get<MarketSheet>(`/market/${id}`), [id]);
  const [ask, setAsk] = useState(false);
  if (sheet.loading && !sheet.data) return <Spinner />;
  if (sheet.error || !sheet.data) return <ErrorBox error={sheet.error} retry={sheet.reload} />;
  const m = sheet.data;
  const st = m.myRequest ? REQUEST_STATUS[m.myRequest.status]! : null;
  return (
    <>
      <button className="link back" onClick={back}><Icon name="back" size={18} /> Retour</button>
      <header className="animal-head card">
        <div className="ico big" aria-hidden="true">{SPECIES[m.species].icon}</div>
        <div className="grow">
          <h1>{m.name}</h1>
          <p className="mute">{SPECIES[m.species].label}{m.breed ? ` · ${m.breed}` : ''}{m.sex ? ` · ${m.sex === 'F' ? 'femelle' : 'mâle'}` : ''} · {m.kind === 'lot' ? `lot de ${unitsLabel(m.species, m.qty ?? 0)}` : '1 animal'} · {m.zone}</p>
          <p className="mute">Éleveur : {m.ownerName}{m.bornOn ? ` · né le ${date(m.bornOn)}` : ''}{m.avgWeightKg ? ` · ${m.avgWeightKg} kg en moyenne` : ''}</p>
          <p><b className="price" style={{ fontSize: '1.4rem' }}>{fcfa(m.price)}</b>{m.kind === 'lot' && ' l\'unité'} <span className="mono mute">{m.code}</span></p>
          {m.bulkMinQty != null && m.bulkPrice != null && <p><Badge tone="green">Prix réduit : {fcfa(m.bulkPrice)} l'unité dès {num(m.bulkMinQty)} achetés</Badge></p>}
          {m.kind === 'lot' && <p className="mute"><b>{unitsLabel(m.species, m.availableQty)}</b> disponibles à la vente{m.availableQty < m.listingQty ? ` (${num(m.listingQty - m.availableQty)} déjà réservés)` : ''}</p>}
        </div>
      </header>
      {m.health.openCases > 0 && <div className="banner warn" role="status">Un cas de maladie est en cours de suivi sur cet animal. Demandez des précisions à l'éleveur avant d'acheter.</div>}
      {m.photos.length > 0 && <Card title="Photos"><div className="photos">{m.photos.map((p) => <figure key={p.id}><img src={photoSrc(p.url)} alt={`Photo de ${m.name}`} loading="lazy" /></figure>)}</div></Card>}
      <Card title="Vaccins faits">
        {!m.health.vaccines.length ? <p className="mute">Aucun vaccin enregistré.</p> : (
          <ul className="rows">{m.health.vaccines.map((v, i) => <li key={i} className="row"><div className="grow"><b>{v.label}</b><br /><span className="mute">{date(v.doneOn)}</span></div>{v.signedByVet && <Badge tone="green">Signé vétérinaire</Badge>}</li>)}</ul>
        )}
        <p className="mute">Cet animal n'est pas en délai d'attente après un traitement. Le carnet complet vous est transmis à l'achat.</p>
      </Card>
      <div className="actions">
        {m.isMine ? <Badge tone="grey">C'est votre annonce</Badge>
          : m.myRequest ? <><Badge tone={st!.tone}>Ma demande : {st!.label}</Badge><Link to={`/demandes?ouvrir=${m.myRequest.id}`} className="btn">Ouvrir la discussion</Link></>
          : m.availableQty < 1 ? <Badge tone="amber">Tout est réservé pour le moment</Badge>
          : <button className="btn pri" onClick={() => setAsk(true)}>Demander à acheter</button>}
      </div>
      <p className="mute">L'éleveur voit votre nom. Son téléphone et le vôtre ne sont partagés que s'il accepte votre demande. Le paiement et la remise de l'animal se font directement entre vous.</p>
      {ask && <AskModal m={m} onClose={() => setAsk(false)} onDone={sheet.reload} />}
    </>
  );
}

function AskModal({ m, onClose, onDone }: { m: MarketSheet; onClose: () => void; onDone: () => void }) {
  const isLot = m.kind === 'lot';
  const [message, setMessage] = useState('');
  const [qty, setQty] = useState(String(isLot ? m.availableQty : 1));
  const [offer, setOffer] = useState('');
  const { busy, run } = useAction();
  const q = Math.floor(Number(qty) || 0);
  const base = unitPriceFor(m, Math.max(q, 1));
  const unit = offer !== '' ? Number(offer) : base;
  const total = unit * Math.max(q, 0);
  const bad = q < 1 || q > m.availableQty ? `Entre 1 et ${num(m.availableQty)}.` : '';
  const reduced = m.bulkMinQty != null && m.bulkPrice != null && offer === '' && q >= m.bulkMinQty;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bad) return;
    const body: Record<string, unknown> = { qty: q };
    if (message.trim()) body.message = message.trim();
    if (offer !== '') body.offeredPrice = Number(offer);
    const r = await run(() => api.post<{ id: string }>(`/market/${m.id}/requests`, body), "Demande envoyée : discutez avec l'éleveur");
    if (r) { onDone(); onClose(); navigate(`/demandes?tab=envoyees&ouvrir=${r.id}`); }
  };
  return (
    <Modal title={`Acheter : ${m.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {isLot && <Field label={`Combien en voulez-vous ? (${num(m.availableQty)} disponibles)`} error={bad}>{(id) => <input id={id} type="number" min={1} max={m.availableQty} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required />}</Field>}
        <Field label="Votre prix à l'unité en FCFA (facultatif)" hint={`Prix de l'annonce pour cette quantité : ${fcfa(base)}${m.bulkMinQty != null && q < m.bulkMinQty ? ` ; ${fcfa(m.bulkPrice!)} dès ${num(m.bulkMinQty)}` : ''}. Vous pourrez en discuter ensuite.`}>{(id) => <input id={id} type="number" min={0} inputMode="numeric" value={offer} onChange={(e) => setOffer(e.target.value)} />}</Field>
        <div className="banner info" role="status" aria-live="polite"><b>{isLot ? unitsLabel(m.species, Math.max(q, 0)) : '1 animal'} × {fcfa(unit)} = {fcfa(total)}</b>{reduced && <><br />Prix réduit appliqué.</>}</div>
        <Field label="Votre message à l'éleveur (facultatif)" hint="Par exemple : « Pour mon restaurant, livraison samedi. »">{(id) => <textarea id={id} rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
        <div className="actions end"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn pri" disabled={busy || !!bad}>{busy ? 'Envoi…' : 'Envoyer la demande'}</button></div>
      </form>
    </Modal>
  );
}
