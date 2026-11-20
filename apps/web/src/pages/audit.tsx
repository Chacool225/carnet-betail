import { api, qs } from '../api/client';
import type { AuditEntry, HistoryCategory, Page } from '../api/types';
import { Badge, Card, Empty, ErrorBox, PageHead, Pager, Spinner, useQuery } from '../ui/kit';
import { DateRange, ResetFilters, SearchBox, useUrlFilters } from '../ui/filters';
import { Link } from '../lib/router';
import { HISTORY_CATEGORY, ROLE_LABEL, dateTime } from '../lib/format';

const TONE: Record<HistoryCategory, 'green' | 'amber' | 'red' | 'blue' | 'grey'> = { compte: 'grey', animal: 'green', sante: 'blue', mouvement: 'amber', acces: 'grey', marche: 'blue', alerte: 'red' };

/** Journal d'audit de toute la plateforme (autorité) : qui a fait quoi, quand, sur quel animal. Lecture seule. */
export function AuditPage() {
  const f = useUrlFilters({ q: '', category: '', role: '', from: '', to: '', order: 'desc' });
  const v = f.values;
  const list = useQuery(() => api.get<Page<AuditEntry>>(`/audit${qs({ ...v, page: f.page, limit: 30 })}`), [JSON.stringify(v), f.page]);
  return (
    <>
      <PageHead title="Journal d'audit" sub={list.data ? `${list.data.total} évènement(s) · lecture seule` : undefined} />
      <div className="filters">
        <SearchBox value={v.q} onChange={(q) => f.set({ q })} placeholder="Personne, téléphone, animal, action…" />
        <select aria-label="Catégorie" value={v.category} onChange={(e) => f.set({ category: e.target.value })}>
          <option value="">Toutes les catégories</option>{Object.entries(HISTORY_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Profil" value={v.role} onChange={(e) => f.set({ role: e.target.value })}>
          <option value="">Tous les profils</option>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Trier" value={v.order} onChange={(e) => f.set({ order: e.target.value })}>
          <option value="desc">Plus récents d'abord</option><option value="asc">Plus anciens d'abord</option>
        </select>
        <DateRange from={v.from} to={v.to} onChange={(from, to) => f.set({ from, to })} />
        <ResetFilters count={f.active(['order'])} onReset={f.reset} />
      </div>
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox error={list.error} retry={list.reload} /> : (
        <Card>
          {!list.data?.items.length ? <Empty icon="list" title="Aucun évènement">Aucun résultat avec ces filtres.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Qui</th><th>Action</th><th>Animal</th></tr></thead>
              <tbody>{list.data.items.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.at)}</td>
                  <td>{e.actor ? <>{e.actor.name} <span className="mute">({ROLE_LABEL[e.actor.role as keyof typeof ROLE_LABEL] ?? e.actor.role})</span></> : 'Système'}</td>
                  <td>{e.label} <Badge tone={TONE[e.category]}>{HISTORY_CATEGORY[e.category]}</Badge></td>
                  <td>{e.animal ? <Link to={`/animaux/${e.animal.id}`}>{e.animal.name} <span className="mono">{e.animal.code}</span></Link> : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {list.data && <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={f.setPage} />}
        </Card>
      )}
    </>
  );
}
