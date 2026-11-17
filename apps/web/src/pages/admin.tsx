import { api, downloadCsv } from '../api/client';
import type { StatsOverview, ZoneStats } from '../api/types';
import { Badge, Card, Empty, ErrorBox, Icon, PageHead, Spinner, Stat, useAction, useQuery, useToast } from '../ui/kit';
import { SPECIES, errorText, date, num, pct, phone } from '../lib/format';
import type { Species } from '../api/types';

interface PendingVet { id: string; name: string; phone: string; zone: string | null; clinic: string | null; orderNumber: string; registeredAt: string | null }

export function StatsPage() {
  const toast = useToast();
  const o = useQuery(() => api.get<StatsOverview>('/stats/overview'), []);
  const z = useQuery(() => api.get<{ items: ZoneStats[] }>('/stats/zones'), []);
  const dl = async (path: string, name: string) => { try { await downloadCsv(path, name); } catch (e) { toast(errorText(e), 'err'); } };
  if (o.loading && !o.data) return <Spinner />;
  if (o.error || !o.data) return <ErrorBox error={o.error} retry={o.reload} />;
  const d = o.data;
  const max = Math.max(1, ...d.topDiseases.map((x) => x.cases));
  return (
    <>
      <PageHead title="Indicateurs" sub={`${d.scope === 'national' ? 'National' : 'Ma zone'} · ${d.periodDays} derniers jours`}>
        <button className="btn" onClick={() => dl('/export/animals.csv', 'animaux.csv')}><Icon name="download" /> Animaux (CSV)</button>
        <button className="btn" onClick={() => dl('/export/cases.csv', 'signalements.csv')}><Icon name="download" /> Signalements (CSV)</button>
      </PageHead>
      <div className="stats">
        <Stat label="Cas ouverts" value={num(d.openCases)} tone={d.openCases ? 'amber' : undefined} />
        <Stat label="Morts déclarées" value={num(d.deaths)} />
        <Stat label="Alertes vol" value={num(d.unhandledAlerts.vol ?? 0)} tone={d.unhandledAlerts.vol ? 'red' : undefined} />
        <Stat label="Alertes sanitaires" value={num(d.unhandledAlerts.sanitaire ?? 0)} tone={d.unhandledAlerts.sanitaire ? 'red' : undefined} />
      </div>
      <div className="grid2">
        <Card title="Cheptel actif par espèce">
          {!d.activeBySpecies.length ? <p className="mute">Aucun animal actif.</p> : <ul className="plain">{d.activeBySpecies.map((s) => <li key={s.species}>{SPECIES[s.species as Species]?.icon} {SPECIES[s.species as Species]?.label ?? s.species} : <b>{num(s.heads)}</b> têtes <span className="mute">({num(s.animals)} fiches)</span></li>)}</ul>}
        </Card>
        <Card title="Maladies les plus signalées">
          {!d.topDiseases.length ? <p className="mute">Aucun signalement.</p> : (
            <ul className="bars">{d.topDiseases.map((x) => <li key={x.disease}><span>{x.disease} {x.notifiable && <Badge tone="red">Obligatoire</Badge>}</span><span className="track"><i style={{ width: `${(x.cases / max) * 100}%` }} /></span><b>{x.cases}</b></li>)}</ul>
          )}
        </Card>
      </div>
      <Card title="Par zone">
        {z.loading && !z.data ? <Spinner /> : !z.data?.items.length ? <Empty icon="chart" title="Pas de données par zone" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Zone</th><th>Fiches</th><th>Têtes</th><th>Cas ouverts</th><th>Mortalité</th><th>Vols</th><th>Alertes</th></tr></thead>
            <tbody>{z.data.items.map((r) => <tr key={r.zone.id}><th scope="row">{r.zone.name}</th><td>{num(r.animals)}</td><td>{num(r.heads)}</td><td>{r.openCases}</td><td>{pct(r.mortalityRate)}</td><td>{r.stolen}</td><td>{r.unhandledAlerts}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

export function VetsPage() {
  const pending = useQuery(() => api.get<{ items: PendingVet[] }>('/vets/pending'), []);
  const { busy, run } = useAction();
  const verify = async (v: PendingVet) => {
    const r = await run(() => api.post(`/vets/${v.id}/verify`, {}), `${v.name} est vérifié`);
    if (r !== undefined) pending.reload();
  };
  return (
    <>
      <PageHead title="Vétérinaires" sub="Vérifiez le numéro d'ordre avant de valider : un vétérinaire vérifié peut scanner et soigner les animaux." />
      {pending.loading && !pending.data ? <Spinner /> : pending.error ? <ErrorBox error={pending.error} retry={pending.reload} /> : (
        <Card title={`En attente (${pending.data?.items.length ?? 0})`}>
          {!pending.data?.items.length ? <Empty icon="shield" title="Aucune demande en attente" /> : (
            <ul className="rows">{pending.data.items.map((v) => <li key={v.id} className="row"><div className="grow"><b>{v.name}</b> <span className="mono">{v.orderNumber}</span><br /><span className="mute">{v.clinic ?? 'Sans cabinet'} · {v.zone ?? '—'} · {phone(v.phone)}{v.registeredAt ? ` · inscrit le ${date(v.registeredAt)}` : ''}</span></div><button className="btn pri" disabled={busy} onClick={() => verify(v)}>Valider</button></li>)}</ul>
          )}
        </Card>
      )}
    </>
  );
}
