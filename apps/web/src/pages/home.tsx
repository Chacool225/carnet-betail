import { api, cachedGet, qs } from '../api/client';
import type { AccessItem, AgentOverview, Alert, Page, Animal, Reminder, StatsOverview, ZoneStats } from '../api/types';
import { Badge, Card, Empty, ErrorBox, Icon, PageHead, Spinner, Speak, Stat, useAction, useAutoSpeak, useQuery } from '../ui/kit';
import { useAuth } from '../ui/auth';
import { Link } from '../lib/router';
import { date, num, pct, SPECIES } from '../lib/format';
import { AlertList } from './alerts';
import { useLang, type Key } from '../i18n';

export function Home() {
  const { user } = useAuth();
  if (!user) return null;
  switch (user.role) {
    case 'eleveur': return user.prefs.simple ? <SimpleHome /> : <EleveurHome />;
    case 'particulier': return <ParticulierHome />;
    case 'vet': return <VetHome />;
    case 'agent': return <AgentHome />;
    case 'autorite': return <AuthorityHome />;
  }
}

function Reminders({ items }: { items: Reminder[] }) {
  if (!items.length) return <Empty icon="check" title="Rien à faire pour l'instant">Les vaccins et soins à venir apparaîtront ici.</Empty>;
  return (
    <ul className="rows">
      {items.slice(0, 6).map((r) => (
        <li key={r.eventId}>
          <Link to={`/animaux/${r.animal.id}`} className="row">
            <div><b>{r.label}</b><span className="mute"> · {r.animal.name} <span className="mono">{r.animal.code}</span></span></div>
            <Badge tone={r.overdue ? 'red' : 'amber'}>{r.overdue ? 'En retard · ' : ''}{date(r.dueOn)}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EleveurHome() {
  const { user } = useAuth();
  const animals = useQuery(() => cachedGet<Page<Animal>>(`/animals${qs({ status: 'actif', limit: 100 })}`, user!.id), [], { cached: true });
  const reminders = useQuery(() => cachedGet<{ items: Reminder[] }>('/reminders?days=30', user!.id), [], { cached: true });
  const alerts = useQuery(() => cachedGet<Page<Alert>>('/alerts?handled=false&limit=3', user!.id), [], { cached: true });
  const list = animals.data?.items ?? [];
  const heads = list.reduce((s, a) => s + (a.qty ?? 1), 0);
  const late = reminders.data?.items.filter((r) => r.overdue).length ?? 0;
  return (
    <>
      <PageHead title={`Bonjour ${user!.name.split(' ')[0]}`} sub={user!.zone ? `Élevage · ${user!.zone.name}` : 'Pensez à renseigner votre zone dans votre profil.'}>
        <Link to="/animaux/nouveau" className="btn pri"><Icon name="plus" /> Nouvel animal</Link>
      </PageHead>
      {animals.stale && <div className="banner off">Données enregistrées le {date(animals.stale)} (hors-ligne).</div>}
      <div className="stats">
        <Stat label="Fiches actives" value={animals.loading && !animals.data ? '…' : num(animals.data?.total ?? 0)} />
        <Stat label="Têtes de bétail" value={animals.loading && !animals.data ? '…' : `${num(heads)}${(animals.data?.total ?? 0) > 100 ? '+' : ''}`} />
        <Stat label="Rappels en retard" value={late} tone={late ? 'red' : undefined} />
        <Stat label="Alertes dans ma zone" value={alerts.data?.total ?? 0} tone={alerts.data?.total ? 'amber' : undefined} />
      </div>
      <div className="grid2">
        <Card title="À faire dans les 30 jours" actions={<Link to="/animaux" className="more">Mes animaux <Icon name="chev" size={16} /></Link>}>
          {reminders.loading && !reminders.data ? <Spinner /> : reminders.error && !reminders.data ? <ErrorBox error={reminders.error} retry={reminders.reload} /> : <Reminders items={reminders.data?.items ?? []} />}
        </Card>
        <Card title="Alertes à surveiller" actions={<Link to="/alertes" className="more">Tout voir <Icon name="chev" size={16} /></Link>}>
          {alerts.loading && !alerts.data ? <Spinner /> : <AlertList items={alerts.data?.items ?? []} empty="Aucune alerte en cours dans votre zone." />}
        </Card>
      </div>
    </>
  );
}

const TILES: { to: string; icon: string; label: Key; say: Key }[] = [
  { to: '/animaux', icon: '🐄', label: 'tile.myAnimals', say: 'say.myAnimals' },
  { to: '/animaux/nouveau', icon: '➕', label: 'tile.addAnimal', say: 'say.addAnimal' },
  { to: '/animaux?do=maladie', icon: '🤒', label: 'tile.sick', say: 'say.sick' },
  { to: '/scan', icon: '📷', label: 'tile.scan', say: 'say.scan' },
  { to: '/marche', icon: '🛒', label: 'tile.market', say: 'say.market' },
  { to: '/alertes', icon: '🔔', label: 'tile.alerts', say: 'say.alerts' },
];

function SimpleHome() {
  const { user } = useAuth();
  const { t } = useLang();
  const reminders = useQuery(() => cachedGet<{ items: Reminder[] }>('/reminders?days=7', user!.id), [], { cached: true });
  const late = reminders.data?.items.length ?? 0;
  useAutoSpeak(user!.prefs.autoVoice !== false, 'say.home.hello');
  return (
    <>
      <PageHead title={t('home.hello', { name: user!.name.split(' ')[0] })} sub={late ? `${late} soin(s) ou vaccin(s) à faire cette semaine` : t('home.whatToDo')}>
        <Speak k="home.whatToDo" text="" />
      </PageHead>
      <div className="tiles">
        {TILES.map((tl) => (
          <Link key={tl.to} to={tl.to} className="tile">
            <span className="big" aria-hidden="true">{tl.icon}</span>
            <b>{t(tl.label)}</b>
            <Speak k={tl.say} text="" />
          </Link>
        ))}
      </div>
      {late > 0 && <Card title={t('home.thisWeek')}><Reminders items={reminders.data?.items ?? []} /></Card>}
    </>
  );
}

function VetHome() {
  const { user } = useAuth();
  const access = useQuery(() => cachedGet<{ items: AccessItem[] }>('/access', user!.id), [], { cached: true });
  const unverified = user!.vet && !user!.vet.verified;
  const daysLeft = (d: string) => Math.max(0, Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86_400_000));
  return (
    <>
      <PageHead title={`Dr ${user!.name.replace(/^Dr\.?\s*/i, '')}`} sub={user!.vet?.clinic ?? 'Vétérinaire'}>
        <Link to="/scan" className="btn pri"><Icon name="scan" /> Scanner un animal</Link>
      </PageHead>
      {unverified && (
        <div className="banner warn" role="status">
          <Icon name="shield" /> Votre numéro d'ordre <b>{user!.vet!.orderNumber}</b> n'a pas encore été vérifié par l'autorité. Vous pourrez consulter des dossiers dès qu'il le sera.
        </div>
      )}
      <Card title="Mes accès en cours" actions={<span className="mute">Un scan ou un soin prolonge l'accès de 30 jours</span>}>
        {access.loading && !access.data ? <Spinner /> : access.error && !access.data ? <ErrorBox error={access.error} retry={access.reload} /> : !access.data?.items.length ? (
          <Empty icon="scan" title="Aucun accès pour le moment">Scannez le QR code ou la boucle d'un animal pour ouvrir son dossier.</Empty>
        ) : (
          <ul className="rows">
            {access.data.items.map((i) => (
              <li key={i.animal.id}>
                <Link to={`/animaux/${i.animal.id}`} className="row">
                  <div><b>{SPECIES[i.animal.species]?.icon} {i.animal.name}</b> <span className="mono mute">{i.animal.code}</span><br /><span className="mute">{i.animal.ownerName} · {i.animal.zone}</span></div>
                  <Badge tone={daysLeft(i.expiresOn) <= 3 ? 'amber' : 'green'}>{daysLeft(i.expiresOn)} j restants</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function AgentHome() {
  const { user } = useAuth();
  const ov = useQuery(() => api.get<AgentOverview>('/agent/overview'), []);
  const alerts = useQuery(() => api.get<Page<Alert>>('/alerts?handled=false&limit=10'), []);
  const { busy, run } = useAction();
  const handle = async (id: string) => { if (await run(() => api.patch(`/alerts/${id}/handle`, {}), 'Alerte prise en charge')) { alerts.reload(); ov.reload(); } };
  return (
    <>
      <PageHead title="Ma zone" sub={ov.data?.zone?.name ?? user!.zone?.name ?? 'Zone non renseignée'}>
        <Link to="/scan" className="btn"><Icon name="scan" /> Scanner</Link>
      </PageHead>
      {ov.error && <ErrorBox error={ov.error} retry={ov.reload} />}
      {ov.data && (
        <div className="stats">
          <Stat label="Fiches actives" value={num(ov.data.animals)} />
          <Stat label="Têtes de bétail" value={num(ov.data.heads)} />
          <Stat label="Signalements ouverts" value={ov.data.openCases} tone={ov.data.openCases ? 'amber' : undefined} />
          <Stat label="Animaux volés" value={ov.data.stolen} tone={ov.data.stolen ? 'red' : undefined} />
          <Stat label="Alertes à traiter" value={ov.data.unhandledAlerts} tone={ov.data.unhandledAlerts ? 'red' : undefined} />
        </div>
      )}
      <Card title="Alertes à traiter" actions={<Link to="/alertes" className="more">Tout voir <Icon name="chev" size={16} /></Link>}>
        {alerts.loading && !alerts.data ? <Spinner /> : <AlertList items={alerts.data?.items ?? []} empty="Aucune alerte à traiter dans votre zone." onHandle={busy ? undefined : handle} />}
      </Card>
    </>
  );
}

function AuthorityHome() {
  const ov = useQuery(() => api.get<StatsOverview>('/stats/overview'), []);
  const zones = useQuery(() => api.get<{ items: ZoneStats[] }>('/stats/zones'), []);
  const alerts = useQuery(() => api.get<Page<Alert>>('/alerts?handled=false&limit=5'), []);
  const { busy, run } = useAction();
  const handle = async (id: string) => { if (await run(() => api.patch(`/alerts/${id}/handle`, {}), 'Alerte prise en charge')) { alerts.reload(); ov.reload(); zones.reload(); } };
  const active = ov.data?.animalsByStatus.find((s) => s.status === 'actif');
  const unhandled = ov.data ? Object.values(ov.data.unhandledAlerts).reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <PageHead title="Vue nationale" sub="Santé animale, alertes et vétérinaires">
        <Link to="/stats" className="btn"><Icon name="chart" /> Indicateurs détaillés</Link>
      </PageHead>
      {ov.error && <ErrorBox error={ov.error} retry={ov.reload} />}
      {ov.data && (
        <div className="stats">
          <Stat label="Fiches actives" value={num(active?.animals ?? 0)} />
          <Stat label="Têtes de bétail" value={num(active?.heads ?? 0)} />
          <Stat label="Signalements ouverts" value={ov.data.openCases} tone={ov.data.openCases ? 'amber' : undefined} />
          <Stat label={`Morts sur ${ov.data.periodDays} j`} value={num(ov.data.deaths)} />
          <Stat label="Alertes à traiter" value={unhandled} tone={unhandled ? 'red' : undefined} />
          <Stat label="Vétérinaires vérifiés" value={`${ov.data.vets.verified}/${ov.data.vets.total}`} />
        </div>
      )}
      <div className="grid2">
        <Card title="Alertes à traiter" actions={<Link to="/alertes" className="more">Tout voir <Icon name="chev" size={16} /></Link>}>
          {alerts.loading && !alerts.data ? <Spinner /> : <AlertList items={alerts.data?.items ?? []} empty="Aucune alerte à traiter." onHandle={busy ? undefined : handle} />}
        </Card>
        <Card title="Zones les plus touchées">
          {!zones.data ? <Spinner /> : (
            <ul className="rows">
              {[...zones.data.items].sort((a, b) => b.mortalityRate - a.mortalityRate || b.openCases - a.openCases).slice(0, 5).map((z) => (
                <li key={z.zone.id} className="row static">
                  <div><b>{z.zone.name}</b><br /><span className="mute">{num(z.heads)} têtes · {z.openCases} signalement(s)</span></div>
                  <Badge tone={z.mortalityRate >= 0.1 ? 'red' : z.mortalityRate > 0 ? 'amber' : 'green'}>{pct(z.mortalityRate)} de mortalité</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ParticulierHome() {
  const { user } = useAuth();
  const mine = useQuery(() => cachedGet<Page<Animal>>(`/animals${qs({ limit: 5 })}`, user!.id), [], { cached: true });
  const reqs = useQuery(() => api.get<Page<{ id: string; status: string; animal: { name: string }; other: { name: string; phone: string | null } }>>('/me/purchase-requests?limit=5'), []);
  return (
    <>
      <PageHead title={`Bonjour ${user!.name.split(' ')[0]}`} sub="Trouvez un animal en bonne santé, avec son carnet complet." />
      <Card title="Acheter un animal"><p>Parcourez les annonces des éleveurs : chaque fiche montre l'espèce, le prix, les vaccins faits et si un cas de maladie est en cours.</p><Link to="/marche" className="btn pri">Voir le marché</Link></Card>
      <Card title="Mes demandes" actions={<Link to="/demandes" className="btn sm">Tout voir</Link>}>
        {!reqs.data?.items.length ? <Empty icon="shop" title="Aucune demande">Faites une demande depuis une annonce du marché.</Empty> : (
          <ul className="rows">{reqs.data.items.map((r) => <li key={r.id} className="row"><div className="grow"><b>{r.animal.name}</b><br /><span className="mute">{r.other.name}{r.other.phone ? ` · ${r.other.phone}` : ''}</span></div><Badge tone={r.status === 'acceptee' ? 'green' : r.status === 'en_attente' ? 'amber' : 'grey'}>{r.status.replace('_', ' ')}</Badge></li>)}</ul>
        )}
      </Card>
      <Card title="Mes animaux" actions={<Link to="/animaux" className="btn sm">Tout voir</Link>}>
        {!mine.data?.items.length ? <Empty icon="cow" title="Pas encore d'animal">Après un achat conclu, la fiche et son carnet de santé arrivent ici.</Empty> : (
          <ul className="rows">{mine.data.items.map((a) => <li key={a.id}><Link to={`/animaux/${a.id}`} className="row"><span className="ico" aria-hidden="true">{SPECIES[a.species].icon}</span><div className="grow"><b>{a.name}</b> <span className="mono mute">{a.code}</span></div></Link></li>)}</ul>
        )}
      </Card>
    </>
  );
}
