import { api, ApiError } from '../api/client';
import type { Archive, Animal, Case, Flow, HealthEvent } from '../api/types';
import { Badge, ErrorBox, Icon, QrCode, Spinner, useQuery } from '../ui/kit';
import { useAuth } from '../ui/auth';
import { back } from '../lib/router';
import { CASE_STATUS, EVENT_TYPE, EXIT_LABEL, FLOW_LABEL, SEVERITY, SPECIES, date, dateTime, headcount } from '../lib/format';

interface Dossier {
  animal: Pick<Animal, 'id' | 'code' | 'kind' | 'species' | 'name' | 'breed' | 'sex' | 'bornOn' | 'qty' | 'qtyInitial'>;
  ownerName: string | null; zone: string | null;
  events: HealthEvent[]; cases: Case[]; flows: Flow[];
  exit: { type: string; on: string } | null; cutoff: string | null;
}

/** Charge le dossier complet de l'animal ; si la fiche n'est plus à moi (vendue à un inscrit), prend l'archive figée. */
async function loadDossier(id: string): Promise<Dossier> {
  try {
    const [a, e, c, f] = await Promise.all([
      api.get<Animal>(`/animals/${id}`), api.get<{ items: HealthEvent[] }>(`/animals/${id}/health-events?order=asc`),
      api.get<{ items: Case[] }>(`/animals/${id}/cases`), api.get<{ items: Flow[] }>(`/animals/${id}/flows?order=asc`),
    ]);
    return { animal: a, ownerName: a.owner.name, zone: a.zone.name, events: e.items, cases: c.items, flows: f.items, exit: a.status === 'actif' ? null : { type: a.status === 'decede' ? 'deces' : a.status === 'vole' ? 'vol' : a.status === 'abattu' ? 'abattage' : 'vente', on: a.updatedAt?.slice(0, 10) ?? '' }, cutoff: null };
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    const r = await api.get<Archive>(`/animals/${id}/archive`);
    return { animal: { ...r.animal, qty: null } as Dossier['animal'], ownerName: null, zone: null, events: [...r.events].reverse(), cases: r.cases, flows: [...r.flows].reverse(), exit: r.exit, cutoff: r.cutoff };
  }
}

function PrintShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="noprint actions" style={{ marginBottom: '1rem' }}>
        <button className="btn" onClick={back}><Icon name="back" size={18} /> Retour</button>
        <button className="btn pri" onClick={() => window.print()}><Icon name="download" size={18} /> Imprimer ou enregistrer en PDF</button>
        <span className="mute">Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF ».</span>
      </div>
      <article className="paper" aria-label={title}>{children}</article>
    </>
  );
}

const Head = ({ d, title }: { d: Dossier; title: string }) => (
  <header className="paper-head">
    <div>
      <p className="paper-brand">CARNET BÉTAIL · Côte d'Ivoire</p>
      <h1>{title}</h1>
      <p><b>{d.animal.name}</b> · {SPECIES[d.animal.species].label}{d.animal.breed ? ` · ${d.animal.breed}` : ''}{d.animal.sex ? ` · ${d.animal.sex === 'F' ? 'femelle' : 'mâle'}` : ''}</p>
      <p>Code : <b className="mono">{d.animal.code}</b>{d.animal.bornOn ? ` · né le ${date(d.animal.bornOn)}` : ''}{d.animal.kind === 'lot' ? ` · ${d.animal.qty != null ? headcount({ kind: 'lot', qty: d.animal.qty, species: d.animal.species }) : `${d.animal.qtyInitial ?? '?'} au départ`}` : ''}</p>
    </div>
    <QrCode text={d.animal.code} size={110} />
  </header>
);

/** Carnet de santé imprimable : tous les actes, les maladies et les mouvements, avec le QR de l'animal. */
export function CarnetPrint({ id }: { id: string }) {
  const q = useQuery(() => loadDossier(id), [id]);
  if (q.loading && !q.data) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.reload} />;
  const d = q.data;
  return (
    <PrintShell title="Carnet de santé">
      <Head d={d} title="Carnet de santé" />
      {d.cutoff && <p className="paper-note">Dossier archivé : il s'arrête au {date(d.cutoff)} ({d.exit ? EXIT_LABEL[d.exit.type] : 'sortie'} le {d.exit ? date(d.exit.on) : ''}).</p>}
      {d.ownerName && <p>Propriétaire : <b>{d.ownerName}</b>{d.zone ? ` · ${d.zone}` : ''}</p>}
      <h2>Vaccins, soins et contrôles</h2>
      {!d.events.length ? <p>Aucun acte enregistré.</p> : (
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Acte</th><th>Prochain</th><th>Délai d'attente</th><th>Fait par</th></tr></thead>
          <tbody>{d.events.map((e) => (
            <tr key={e.id} className={e.correctedBy ? 'struck' : ''}>
              <td>{date(e.doneOn)}</td><td>{EVENT_TYPE[e.type]}</td><td>{e.label}{e.note ? ` — ${e.note}` : ''}{e.correctedBy ? ' (corrigé)' : ''}</td>
              <td>{e.nextDueOn ? date(e.nextDueOn) : ''}</td><td>{e.withdrawalDays ? `${e.withdrawalDays} j` : ''}</td>
              <td>{e.signedByVet && e.vet ? `Dr ${e.vet.name} (signé)` : e.recordedBy.name}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <h2>Maladies signalées</h2>
      {!d.cases.length ? <p>Aucune.</p> : (
        <table>
          <thead><tr><th>Ouverte le</th><th>Maladie</th><th>Gravité</th><th>Touchés</th><th>Morts</th><th>État</th></tr></thead>
          <tbody>{d.cases.map((c) => <tr key={c.id}><td>{date(c.openedOn)}</td><td>{c.diseases.join(', ')}</td><td>{SEVERITY[c.severity]}</td><td>{c.affectedCount}</td><td>{c.deaths}</td><td>{CASE_STATUS[c.status]}{c.closedOn ? ` le ${date(c.closedOn)}` : ''}</td></tr>)}</tbody>
        </table>
      )}
      <h2>Mouvements</h2>
      {!d.flows.length ? <p>Aucun.</p> : (
        <table>
          <thead><tr><th>Date</th><th>Mouvement</th><th>Quantité</th><th>Détail</th></tr></thead>
          <tbody>{d.flows.map((f) => <tr key={f.id}><td>{date(f.occurredOn)}</td><td>{FLOW_LABEL[f.type] ?? f.type}</td><td>{f.qty ?? ''}</td><td>{[f.counterpart, f.note].filter(Boolean).join(' · ')}</td></tr>)}</tbody>
        </table>
      )}
      <footer className="paper-foot">Imprimé le {dateTime(new Date().toISOString())} depuis Carnet Bétail. Les actes signés par un vétérinaire sont identifiés ; les autres sont déclarés par l'éleveur.</footer>
    </PrintShell>
  );
}

const priceOf = (note: string | null): string | null => /Prix : (\d+) FCFA/.exec(note ?? '')?.[1] ?? null;

/** Certificat de vente : atteste l'enregistrement de la vente et de l'état de santé connu à cette date. */
export function CertificatPrint({ id }: { id: string }) {
  const { user } = useAuth();
  const q = useQuery(() => loadDossier(id), [id]);
  if (q.loading && !q.data) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.reload} />;
  const d = q.data;
  const sale = [...d.flows].reverse().find((f) => f.type === 'vente');
  if (!sale) return (
    <PrintShell title="Certificat de vente">
      <p>Aucune vente n'est enregistrée pour <b>{d.animal.name}</b>. Enregistrez d'abord la vente depuis sa fiche.</p>
    </PrintShell>
  );
  const price = priceOf(sale.note);
  const vaccines = d.events.filter((e) => e.type === 'vaccin' && !e.correctedBy && e.doneOn <= sale.occurredOn);
  return (
    <PrintShell title="Certificat de vente">
      <Head d={d} title="Certificat de vente d'un animal" />
      <table className="plain">
        <tbody>
          <tr><th>Date de la vente</th><td>{date(sale.occurredOn)}</td></tr>
          <tr><th>Vendeur</th><td>{sale.recordedBy.name}</td></tr>
          <tr><th>Acheteur</th><td>{sale.counterpart ?? 'Non renseigné'}</td></tr>
          <tr><th>Quantité</th><td>{sale.qty ?? 1}</td></tr>
          <tr><th>Prix convenu</th><td>{price ? `${new Intl.NumberFormat('fr-FR').format(Number(price))} FCFA` : 'Non renseigné'}</td></tr>
        </tbody>
      </table>
      <h2>Santé connue au jour de la vente</h2>
      {!vaccines.length ? <p>Aucun vaccin enregistré.</p> : <ul>{vaccines.map((e) => <li key={e.id}>{e.label} — {date(e.doneOn)}{e.signedByVet ? ' (signé par un vétérinaire)' : ''}</li>)}</ul>}
      <p>{d.events.some((e) => e.withdrawalUntil && e.withdrawalUntil > sale.occurredOn) ? "Attention : un délai d'attente était en cours." : "Aucun délai d'attente en cours à cette date."}</p>
      <div className="signs">
        <div><p>Le vendeur</p><div className="line" /><p className="mute">{sale.recordedBy.name}{user && user.name === sale.recordedBy.name ? '' : ''}</p></div>
        <div><p>L'acheteur</p><div className="line" /><p className="mute">{sale.counterpart ?? ''}</p></div>
      </div>
      <footer className="paper-foot">Ce certificat est généré par Carnet Bétail à partir de la vente enregistrée ({d.animal.code}). Il ne remplace pas un acte officiel. Imprimé le {dateTime(new Date().toISOString())}. <Badge tone="grey">Vérifiable par scan du QR</Badge></footer>
    </PrintShell>
  );
}
