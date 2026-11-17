import { useState } from 'react';
import { api, qs } from '../api/client';
import type { MarketItem, Page, Zone } from '../api/types';
import { Card, Empty, ErrorBox, Icon, PageHead, Pager, Spinner, useDebounced, useQuery } from '../ui/kit';
import { SPECIES, SPECIES_LIST, date, fcfa, headcount } from '../lib/format';

export function MarketPage() {
  const [q, setQ] = useState('');
  const [species, setSpecies] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [sort, setSort] = useState('listed:desc');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const zones = useQuery(() => api.get<{ items: Zone[] }>('/zones'), []);
  const [s, o] = sort.split(':');
  const list = useQuery(() => api.get<Page<MarketItem>>(`/market${qs({ q: dq, species, zoneId, sort: s, order: o, page, limit: 20 })}`), [dq, species, zoneId, sort, page]);
  const f = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  return (
    <>
      <PageHead title="Marché" sub={list.data ? `${list.data.total} annonce(s)` : undefined} />
      <div className="filters">
        <div className="search"><Icon name="search" size={18} /><input type="search" aria-label="Rechercher" placeholder="Espèce, race, nom…" value={q} onChange={(e) => f(setQ)(e.target.value)} /></div>
        <select aria-label="Espèce" value={species} onChange={(e) => f(setSpecies)(e.target.value)}><option value="">Toutes les espèces</option>{SPECIES_LIST.map((x) => <option key={x} value={x}>{SPECIES[x].label}</option>)}</select>
        <select aria-label="Zone" value={zoneId} onChange={(e) => f(setZoneId)(e.target.value)}><option value="">Toutes les zones</option>{zones.data?.items.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
        <select aria-label="Trier" value={sort} onChange={(e) => f(setSort)(e.target.value)}><option value="listed:desc">Plus récentes</option><option value="price:asc">Prix croissant</option><option value="price:desc">Prix décroissant</option></select>
      </div>
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox error={list.error} retry={list.reload} /> : (
        <Card>
          {!list.data?.items.length ? <Empty icon="shop" title="Aucune annonce">Les animaux sans délai d'attente et sans cas ouvert, mis en vente par leur éleveur, apparaissent ici.</Empty> : (
            <ul className="rows">
              {list.data.items.map((m) => (
                <li key={m.id} className="row">
                  <span className="ico" aria-hidden="true">{SPECIES[m.species].icon}</span>
                  <div className="grow"><b>{m.name}</b>{m.breed && ` · ${m.breed}`}<br /><span className="mute">{headcount(m)} · {m.zone} · {m.ownerName} · publiée le {date(m.listedAt)}</span></div>
                  <b className="price">{fcfa(m.price)}</b>
                </li>
              ))}
            </ul>
          )}
          {list.data && <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
        </Card>
      )}
    </>
  );
}
