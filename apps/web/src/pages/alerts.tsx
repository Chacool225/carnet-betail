import { useState } from 'react';
import { api, qs } from '../api/client';
import type { Alert, Page } from '../api/types';
import { Badge, Empty, ErrorBox, Icon, PageHead, Pager, Spinner, useAction, useQuery } from '../ui/kit';
import { useAuth } from '../ui/auth';
import { Link } from '../lib/router';
import { date } from '../lib/format';

const KIND = { vol: 'Vol', sanitaire: 'Sanitaire', anomalie: 'Anomalie' } as const;
const TONE = { haute: 'red', moyenne: 'amber', basse: 'blue' } as const;

export function AlertList({ items, empty, onHandle }: { items: Alert[]; empty: string; onHandle?: (id: string) => void }) {
  if (!items.length) return <Empty icon="check" title={empty} />;
  return (
    <ul className="rows">
      {items.map((a) => (
        <li key={a.id} className={`alertrow ${a.handled ? 'done' : ''}`}>
          <div className="grow">
            <div className="line"><Badge tone={TONE[a.severity]}>{a.severity}</Badge> <Badge>{KIND[a.kind]}</Badge> {a.zone && <span className="mute">{a.zone.name}</span>} <span className="mute">· {date(a.createdOn)}</span></div>
            <b>{a.title}</b>
            {a.why && <p className="mute">{a.why}</p>}
            {a.animal && <Link to={`/animaux/${a.animal.id}`} className="more">{a.animal.name} <span className="mono">{a.animal.code}</span></Link>}
            {a.handled && <p className="mute"><Icon name="check" size={14} /> Pris en charge{a.handledBy ? ` par ${a.handledBy}` : ''}</p>}
          </div>
          {onHandle && !a.handled && <button className="btn" onClick={() => onHandle(a.id)}>Prendre en charge</button>}
        </li>
      ))}
    </ul>
  );
}

export function AlertsPage() {
  const { user } = useAuth();
  const [kind, setKind] = useState('');
  const [handled, setHandled] = useState('false');
  const [page, setPage] = useState(1);
  const q = useQuery(() => api.get<Page<Alert>>(`/alerts${qs({ kind, handled, page, limit: 20 })}`), [kind, handled, page]);
  const { busy, run } = useAction();
  const canHandle = user!.role === 'agent' || user!.role === 'autorite';
  const handle = async (id: string) => { if (await run(() => api.patch(`/alerts/${id}/handle`, {}), 'Alerte prise en charge')) q.reload(); };
  return (
    <>
      <PageHead title="Alertes" sub={user!.role === 'eleveur' || user!.role === 'vet' ? 'Alertes sanitaires de votre zone et celles de vos animaux' : 'Vols, maladies et anomalies'} />
      <div className="filters">
        <select aria-label="Type" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          <option value="">Tous les types</option><option value="vol">Vol</option><option value="sanitaire">Sanitaire</option><option value="anomalie">Anomalie</option>
        </select>
        <select aria-label="État" value={handled} onChange={(e) => { setHandled(e.target.value); setPage(1); }}>
          <option value="false">À traiter</option><option value="true">Prises en charge</option><option value="">Toutes</option>
        </select>
      </div>
      {q.loading && !q.data ? <Spinner /> : q.error && !q.data ? <ErrorBox error={q.error} retry={q.reload} /> : (
        <div className="card">
          <AlertList items={q.data?.items ?? []} empty="Aucune alerte." onHandle={canHandle && !busy ? handle : undefined} />
          {q.data && <Pager page={q.data.page} limit={q.data.limit} total={q.data.total} onPage={setPage} />}
        </div>
      )}
    </>
  );
}
