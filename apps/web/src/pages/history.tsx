import { useState } from 'react';
import { api, downloadCsv, qs } from '../api/client';
import type { Archive, HealthEvent, HistoryCategory, HistoryEntry, Page } from '../api/types';
import { Badge, Card, Empty, ErrorBox, Icon, PageHead, Pager, Spinner, useQuery, useToast } from '../ui/kit';
import { DateRange, ResetFilters, SearchBox, useUrlFilters } from '../ui/filters';
import { Link, back } from '../lib/router';
import { CASE_STATUS, EVENT_TYPE, EXIT_LABEL, FLOW_LABEL, HISTORY_CATEGORY, SEVERITY, SPECIES, date, errorText, headcount } from '../lib/format';
import { Timeline } from './animal';

const CAT_TONE: Record<HistoryCategory, 'green' | 'amber' | 'red' | 'blue' | 'grey'> = {
  compte: 'grey', animal: 'green', sante: 'blue', mouvement: 'amber', acces: 'grey', marche: 'blue', alerte: 'red',
};
const hour = (d: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(d));
const dayLabel = (d: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
const dayKey = (d: string) => new Date(d).toDateString();

const DEFAULTS = { q: '', category: '', mine: '', from: '', to: '', order: 'desc' };

/** Journal du compte : tout ce que j'ai fait, et ce qui est arrivé à mes animaux. */
export function HistoryPage() {
  const toast = useToast();
  const f = useUrlFilters(DEFAULTS);
  const v = f.values;
  const params = { q: v.q, category: v.category, mine: v.mine, from: v.from, to: v.to, order: v.order };
  const list = useQuery(() => api.get<Page<HistoryEntry>>(`/me/history${qs({ ...params, page: f.page, limit: 30 })}`), [JSON.stringify(params), f.page]);
  const n = f.active(['order']);
  const csv = async () => { try { await downloadCsv(`/export/history.csv${qs(params)}`, 'historique.csv'); } catch (e) { toast(errorText(e), 'err'); } };

  const items = list.data?.items ?? [];
  let last = '';

  return (
    <>
      <PageHead title="Historique" sub={list.data ? `${list.data.total} évènement(s)` : 'Tout ce qui s\'est passé sur votre compte'}>
        <button className="btn" onClick={csv}><Icon name="download" /> Exporter (CSV)</button>
      </PageHead>
      <div className="filters">
        <SearchBox value={v.q} onChange={(q) => f.set({ q })} placeholder="Animal, code, acte, personne…" />
        <select aria-label="Catégorie" value={v.category} onChange={(e) => f.set({ category: e.target.value })}>
          <option value="">Toutes les catégories</option>
          {Object.entries(HISTORY_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Trier" value={v.order} onChange={(e) => f.set({ order: e.target.value })}>
          <option value="desc">Plus récents d'abord</option><option value="asc">Plus anciens d'abord</option>
        </select>
        <DateRange from={v.from} to={v.to} onChange={(from, to) => f.set({ from, to })} />
      </div>
      <div className="filterbar">
        <label className="check"><input type="checkbox" checked={v.mine === 'true'} onChange={(e) => f.set({ mine: e.target.checked ? 'true' : '' })} /> Seulement mes actions</label>
        <ResetFilters count={n} onReset={f.reset} />
      </div>
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox error={list.error} retry={list.reload} /> : (
        <Card>
          {!items.length ? <Empty icon="list" title="Rien à afficher">{n ? 'Aucun évènement ne correspond à ces filtres.' : 'Vos actions apparaîtront ici.'}</Empty> : (
            <ul className="journal">
              {items.map((e) => {
                const k = dayKey(e.at); const head = k !== last; last = k;
                return (
                  <li key={e.id} style={head ? { flexDirection: 'column', gap: 0, padding: 0 } : undefined}>
                    {head && <div className="day">{dayLabel(e.at)}</div>}
                    <div style={head ? { display: 'flex', gap: '.75rem', padding: '.7rem 1rem' } : { display: 'flex', gap: '.75rem', width: '100%' }}>
                      <span className="when">{hour(e.at)}</span>
                      <div className="grow">
                        <b>{e.label}</b> <Badge tone={CAT_TONE[e.category]}>{HISTORY_CATEGORY[e.category]}</Badge>
                        <br /><span className="mute">
                          {e.animal && <><Link to={`/animaux/${e.animal.id}`}>{e.animal.name}</Link> <span className="mono">{e.animal.code}</span> · </>}
                          {e.byMe ? 'Vous' : e.actor ? e.actor.name : 'Système'}
                        </span>
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
    </>
  );
}

const AF = { q: '', type: '', from: '', to: '', order: 'desc' };

/** Fiche d'un animal sorti du cheptel : lecture seule, arrêtée à la date de sortie. */
export function ArchivePage({ id }: { id: string }) {
  const arch = useQuery(() => api.get<Archive>(`/animals/${id}/archive`), [id]);
  const f = useUrlFilters(AF);
  const [tab, setTab] = useState<'sante' | 'cas' | 'mouvements'>('sante');
  if (arch.loading && !arch.data) return <Spinner />;
  if (arch.error || !arch.data) return <ErrorBox error={arch.error} retry={arch.reload} />;
  const { animal: an, exit, cutoff } = arch.data;
  const v = f.values;
  const inRange = (d: string) => (!v.from || d >= v.from) && (!v.to || d <= v.to);
  const text = (...s: (string | null | undefined)[]) => !v.q || s.join(' ').toLowerCase().includes(v.q.toLowerCase());
  const sortBy = <T,>(a: T[], key: (x: T) => string) => [...a].sort((x, y) => (v.order === 'asc' ? 1 : -1) * key(x).localeCompare(key(y)));
  const events = sortBy(arch.data.events.filter((e) => inRange(e.doneOn) && (!v.type || e.type === v.type) && text(e.label, e.note, e.recordedBy.name)), (e) => e.doneOn);
  const cases = sortBy(arch.data.cases.filter((c) => inRange(c.openedOn) && text(c.diseases.join(' '), c.note)), (c) => c.openedOn);
  const flows = sortBy(arch.data.flows.filter((x) => inRange(x.occurredOn) && (!v.type || x.type === v.type) && text(x.counterpart, x.note, x.recordedBy.name)), (x) => x.occurredOn);
  const n = f.active(['order']);
  const tabs: [typeof tab, string, number][] = [['sante', 'Santé', arch.data.events.length], ['cas', 'Maladies', arch.data.cases.length], ['mouvements', 'Mouvements', arch.data.flows.length]];

  return (
    <>
      <button className="link back" onClick={back}><Icon name="back" size={18} /> Retour</button>
      <header className="animal-head card ro">
        <div className="ico big" aria-hidden="true">{SPECIES[an.species].icon}</div>
        <div className="grow">
          <h1>{an.name}</h1>
          <p className="mute">{SPECIES[an.species].label}{an.breed ? ` · ${an.breed}` : ''}{an.sex ? ` · ${an.sex === 'F' ? 'femelle' : 'mâle'}` : ''}{an.kind === 'lot' && an.qtyInitial ? ` · ${headcount({ kind: 'lot', qty: an.qtyInitial, species: an.species })} au départ` : ''}</p>
          <p><Badge tone="grey">{EXIT_LABEL[exit.type]} le {date(exit.on)}</Badge> <span className="mono">{an.code}</span></p>
          {an.bornOn && <p className="mute">Né le {date(an.bornOn)}</p>}
        </div>
      </header>
      <div className="actions" style={{ marginBottom: '.8rem' }}>
        <Link to={`/imprimer/carnet/${an.id}`} className="btn sm">Carnet imprimable (PDF)</Link>
        {exit.type === 'vente' && <Link to={`/imprimer/certificat/${an.id}`} className="btn sm">Certificat de vente</Link>}
      </div>
      <div className="banner info archive" role="status">
        <b>Dossier archivé, en lecture seule.</b> Il s'arrête au {date(cutoff)} : ce qui a été saisi après cette date par le nouveau propriétaire n'est pas visible.
      </div>

      <div className="filters">
        <SearchBox value={v.q} onChange={(q) => f.set({ q })} placeholder="Chercher dans le dossier…" />
        {tab !== 'cas' && (
          <select aria-label="Type" value={v.type} onChange={(e) => f.set({ type: e.target.value })}>
            <option value="">Tous les types</option>
            {tab === 'sante' ? Object.entries(EVENT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>) : Object.entries(FLOW_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        <select aria-label="Trier" value={v.order} onChange={(e) => f.set({ order: e.target.value })}>
          <option value="desc">Plus récents d'abord</option><option value="asc">Plus anciens d'abord</option>
        </select>
        <DateRange from={v.from} to={v.to} onChange={(from, to) => f.set({ from, to })} max={cutoff} />
        <ResetFilters count={n} onReset={f.reset} />
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([t, l, c]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); f.set({ type: '' }); }}>{l} ({c})</button>)}
      </div>

      {tab === 'sante' && <Card title="Historique de santé"><Timeline items={events as HealthEvent[]} /></Card>}
      {tab === 'cas' && (
        <Card title="Cas de maladie">
          {!cases.length ? <p className="mute">Aucun cas{n ? ' avec ces filtres' : ''}.</p> : (
            <ul className="rows">{cases.map((c) => (
              <li key={c.id} className="row"><div className="grow"><b>{c.diseases.join(', ')}</b> <Badge tone={c.severity === 'grave' ? 'red' : c.severity === 'moyenne' ? 'amber' : 'grey'}>{SEVERITY[c.severity]}</Badge> <Badge tone={c.status === 'ouvert' ? 'amber' : 'green'}>{CASE_STATUS[c.status]}</Badge><br /><span className="mute">{date(c.openedOn)} · {c.affectedCount} touché(s)</span></div></li>
            ))}</ul>
          )}
        </Card>
      )}
      {tab === 'mouvements' && (
        <Card title="Mouvements">
          {!flows.length ? <Empty icon="swap" title="Aucun mouvement" /> : (
            <ul className="rows">{flows.map((x) => <li key={x.id} className="row"><div className="grow"><b>{FLOW_LABEL[x.type] ?? x.type}</b>{x.qty != null && ` · ${x.qty}`}{x.counterpart && ` · ${x.counterpart}`}<br /><span className="mute">{date(x.occurredOn)} · {x.recordedBy.name}{x.note ? ` · ${x.note}` : ''}</span></div></li>)}</ul>
          )}
        </Card>
      )}
    </>
  );
}
