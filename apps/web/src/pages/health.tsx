import { api, qs } from '../api/client';
import type { CasesTimeline, HealthMap } from '../api/types';
import { Badge, Card, Empty, Spinner, useQuery } from '../ui/kit';
import { useState } from 'react';
import { date, num } from '../lib/format';

/** Carte schématique des zones (sans fond de carte : elle fonctionne hors-ligne) : une bulle par zone, plus grosse et plus rouge quand il y a plus de cas. */
function ZoneBubbles({ items }: { items: HealthMap['items'] }) {
  const pts = items.filter((i) => i.zone.lat != null && i.zone.lng != null);
  if (!pts.length) return <p className="mute">Les zones n'ont pas de coordonnées : voir le tableau.</p>;
  const lats = pts.map((p) => p.zone.lat!), lngs = pts.map((p) => p.zone.lng!);
  const [minLat, maxLat] = [Math.min(...lats) - 0.3, Math.max(...lats) + 0.3];
  const [minLng, maxLng] = [Math.min(...lngs) - 0.3, Math.max(...lngs) + 0.3];
  const W = 520, H = Math.max(240, Math.min(420, Math.round((W * (maxLat - minLat)) / (maxLng - minLng))));
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * (W - 60) + 30;
  const y = (lat: number) => H - 30 - ((lat - minLat) / (maxLat - minLat)) * (H - 60);
  const max = Math.max(1, ...pts.map((p) => p.cases));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Carte des cas par zone" className="zonemap">
      <rect x="0" y="0" width={W} height={H} rx="12" className="zonemap-bg" />
      {pts.map((p) => {
        const k = p.cases / max;
        const r = p.cases ? 10 + 22 * Math.sqrt(k) : 6;
        return (
          <g key={p.zone.id}>
            <circle cx={x(p.zone.lng!)} cy={y(p.zone.lat!)} r={r} className={p.cases ? (k > 0.66 ? 'bub hot' : k > 0.33 ? 'bub warm' : 'bub mild') : 'bub none'}><title>{`${p.zone.name} : ${p.cases} cas, ${p.openCases} ouverts, ${p.deaths} morts`}</title></circle>
            {p.cases > 0 && <text x={x(p.zone.lng!)} y={y(p.zone.lat!) + 4} textAnchor="middle" className="bub-n">{p.cases}</text>}
            <text x={x(p.zone.lng!)} y={y(p.zone.lat!) + r + 14} textAnchor="middle" className="bub-l">{p.zone.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Curve({ points }: { points: CasesTimeline['points'] }) {
  const W = 520, H = 180, P = 28;
  const max = Math.max(1, ...points.map((p) => p.cases));
  const step = points.length > 1 ? (W - 2 * P) / (points.length - 1) : 0;
  const px = (i: number) => P + i * step, py = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(p.cases).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cas déclarés par semaine" className="curve">
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} className="axis" /><line x1={P} y1={P} x2={P} y2={H - P} className="axis" />
      <text x={P - 6} y={P + 4} textAnchor="end" className="tick">{max}</text><text x={P - 6} y={H - P + 4} textAnchor="end" className="tick">0</text>
      <path d={line} className="line" fill="none" />
      {points.map((p, i) => <circle key={p.weekStart} cx={px(i)} cy={py(p.cases)} r="3.5" className="dot"><title>{`Semaine du ${date(p.weekStart)} : ${p.cases} cas`}</title></circle>)}
      {points.length > 0 && <><text x={P} y={H - 6} className="tick">{date(points[0]!.weekStart)}</text><text x={W - P} y={H - 6} textAnchor="end" className="tick">{date(points[points.length - 1]!.weekStart)}</text></>}
    </svg>
  );
}

/** Carte sanitaire : où et quand les cas sont déclarés, avec filtre par maladie et par période. */
export function HealthMapCard() {
  const [days, setDays] = useState('30');
  const [disease, setDisease] = useState('');
  const map = useQuery(() => api.get<HealthMap>(`/stats/health-map${qs({ days, disease })}`), [days, disease]);
  const line = useQuery(() => api.get<CasesTimeline>(`/stats/cases-timeline${qs({ days: Number(days) < 56 ? 56 : days, disease })}`), [days, disease]);
  return (
    <Card title="Carte sanitaire">
      <div className="filters">
        <select aria-label="Période" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="30">30 derniers jours</option><option value="90">90 derniers jours</option><option value="180">6 mois</option><option value="365">1 an</option>
        </select>
        <select aria-label="Maladie" value={disease} onChange={(e) => setDisease(e.target.value)}>
          <option value="">Toutes les maladies</option>
          {map.data?.diseases.map((d) => <option key={d.disease} value={d.disease}>{d.disease}{d.notifiable ? ' (obligatoire)' : ''} · {d.cases}</option>)}
        </select>
      </div>
      {map.loading && !map.data ? <Spinner /> : !map.data ? null : (
        <div className="grid2">
          <div><ZoneBubbles items={map.data.items} /><p className="mute">Carte schématique : la taille et la couleur des bulles suivent le nombre de cas déclarés.</p></div>
          <div>
            {line.data ? <Curve points={line.data.points} /> : <Spinner />}
            <p className="mute">Cas déclarés par semaine.</p>
          </div>
        </div>
      )}
      {map.data && (map.data.items.every((i) => i.cases === 0)
        ? <Empty icon="chart" title="Aucun cas sur cette période">{disease ? 'Essayez « Toutes les maladies » ou une période plus longue.' : 'Tant mieux : aucun signalement.'}</Empty>
        : <div className="table-wrap"><table>
            <thead><tr><th>Zone</th><th>Cas</th><th>Animaux touchés</th><th>Cas ouverts</th><th>Morts</th></tr></thead>
            <tbody>{map.data.items.filter((i) => i.cases > 0).map((i) => <tr key={i.zone.id}><th scope="row">{i.zone.name}</th><td>{num(i.cases)}</td><td>{num(i.animals)}</td><td>{i.openCases ? <Badge tone="amber">{i.openCases}</Badge> : 0}</td><td>{i.deaths}</td></tr>)}</tbody>
          </table></div>)}
    </Card>
  );
}
