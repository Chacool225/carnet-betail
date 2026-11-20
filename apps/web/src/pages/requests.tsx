import { api, qs } from '../api/client';
import type { Page, PurchaseRequest } from '../api/types';
import { Badge, Card, Empty, ErrorBox, PageHead, Pager, Spinner, useQuery } from '../ui/kit';
import { NegotiationModal } from './negotiation';
import { buyerSummary } from '../ui/buyer';
import { DateRange, ResetFilters, SearchBox, useUrlFilters } from '../ui/filters';
import { useAuth } from '../ui/auth';
import { Link } from '../lib/router';
import { REQUEST_STATUS, SPECIES, dateTime, fcfa, unitsLabel } from '../lib/format';

/** Demandes d'achat : celles que je reçois (éleveur) et celles que j'ai envoyées (éleveur ou particulier). */
export function RequestsPage() {
  const { user } = useAuth();
  const isSeller = user!.role === 'eleveur';
  const f = useUrlFilters({ tab: isSeller ? 'recues' : 'envoyees', q: '', status: '', from: '', to: '', order: 'desc', ouvrir: '' });
  const v = f.values;
  const tab = isSeller ? v.tab : 'envoyees';
  const path = tab === 'recues' ? '/purchase-requests' : '/me/purchase-requests';
  const list = useQuery(() => api.get<Page<PurchaseRequest>>(`${path}${qs({ q: v.q, status: v.status, from: v.from, to: v.to, order: v.order, page: f.page, limit: 20 })}`), [tab, v.q, v.status, v.from, v.to, v.order, f.page]);
  const n = f.active(['tab', 'order', 'ouvrir']);

  return (
    <>
      <PageHead title="Demandes d'achat" sub={list.data ? `${list.data.total} demande(s)` : undefined} />
      {isSeller && (
        <div className="seg wide" role="tablist" aria-label="Type de demandes" style={{ marginBottom: '.8rem' }}>
          <button role="tab" aria-selected={tab === 'recues'} onClick={() => f.set({ tab: 'recues' })}>Reçues (mes animaux)</button>
          <button role="tab" aria-selected={tab === 'envoyees'} onClick={() => f.set({ tab: 'envoyees' })}>Envoyées (mes achats)</button>
        </div>
      )}
      <div className="filters">
        <SearchBox value={v.q} onChange={(q) => f.set({ q })} placeholder="Animal, code, personne, organisation…" />
        <select aria-label="Statut" value={v.status} onChange={(e) => f.set({ status: e.target.value })}>
          <option value="">Tous les statuts</option>{Object.entries(REQUEST_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
        <select aria-label="Trier" value={v.order} onChange={(e) => f.set({ order: e.target.value })}>
          <option value="desc">Plus récentes d'abord</option><option value="asc">Plus anciennes d'abord</option>
        </select>
        <DateRange label="Demande envoyée" from={v.from} to={v.to} onChange={(from, to) => f.set({ from, to })} />
        <ResetFilters count={n} onReset={() => f.set({ q: '', status: '', from: '', to: '' })} />
      </div>
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox error={list.error} retry={list.reload} /> : (
        <Card>
          {!list.data?.items.length ? (
            <Empty icon="shop" title="Aucune demande">{n ? 'Aucun résultat avec ces filtres.' : tab === 'recues' ? "Quand quelqu'un voudra acheter l'un de vos animaux en vente, sa demande apparaîtra ici." : <>Parcourez <Link to="/marche">le marché</Link> pour faire une demande.</>}</Empty>
          ) : (
            <ul className="rows">
              {list.data.items.map((r) => {
                const st = REQUEST_STATUS[r.status]!;
                const deal = r.agreedQty != null && r.agreedPrice != null ? { qty: r.agreedQty, unit: r.agreedPrice, label: 'Accord' }
                  : (tab === 'recues' ? r.theirs : r.mine) ? { qty: (tab === 'recues' ? r.theirs : r.mine)!.qty, unit: (tab === 'recues' ? r.theirs : r.mine)!.unitPrice, label: 'Proposition' } : null;
                const bp = r.buyerProfile;
                return (
                  <li key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
                    <span className="ico" aria-hidden="true">{SPECIES[r.animal.species].icon}</span>
                    <div className="grow">
                      <b>{r.animal.name}</b> <span className="mono mute">{r.animal.code}</span> <Badge tone={st.tone}>{st.label}</Badge>
                      <br /><span className="mute">{tab === 'recues' ? 'Acheteur' : 'Vendeur'} : {r.other.name}{bp && ` (${buyerSummary(bp)})`} · {dateTime(r.createdAt)}</span>
                      {deal && <><br /><b>{deal.label} : {r.animal.kind === 'lot' ? unitsLabel(r.animal.species, deal.qty) : '1 animal'} × {fcfa(deal.unit)} = {fcfa(deal.qty * deal.unit)}</b></>}
                      {r.message && <><br /><em>« {r.message} »</em></>}
                      {r.other.phone && <><br />Téléphone : <a href={`tel:${r.other.phone}`}><b>{r.other.phone}</b></a></>}
                      <div className="actions" style={{ marginTop: '.5rem' }}>
                        <button className="btn pri sm" onClick={() => f.set({ ouvrir: r.id })}>{r.status === 'en_attente' || r.status === 'acceptee' ? 'Ouvrir la discussion' : 'Voir la conversation'}</button>
                        {r.status === 'conclue' && tab === 'envoyees' && <Link to={`/animaux/${r.animal.id}`} className="btn sm">Ouvrir la fiche</Link>}
                        {r.status === 'conclue' && tab === 'recues' && <Link to={`/imprimer/certificat/${r.animal.id}`} className="btn sm">Certificat de vente</Link>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {list.data && <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={f.setPage} />}
        </Card>
      )}
      {v.ouvrir && <NegotiationModal id={v.ouvrir} onClose={() => f.set({ ouvrir: '' })} onChanged={list.reload} />}
    </>
  );
}
