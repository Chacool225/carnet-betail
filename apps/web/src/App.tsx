import { useEffect } from 'react';
import { RouterProvider, match, navigate, useLoc } from './lib/router';
import { AuthProvider, useAuth } from './ui/auth';
import { ToastProvider, Spinner, Empty } from './ui/kit';
import { Shell } from './ui/shell';
import { ForgotPage, LoginPage, RegisterPage } from './pages/auth';
import { Home } from './pages/home';
import { AlertsPage } from './pages/alerts';
import { AnimalsPage, NewAnimalPage } from './pages/animals';
import { AnimalPage } from './pages/animal';
import { ArchivePage, HistoryPage } from './pages/history';
import { ScanPage } from './pages/scan';
import { MarketDetailPage, MarketPage } from './pages/market';
import { AuditPage } from './pages/audit';
import { RequestsPage } from './pages/requests';
import { NotificationsPage } from './pages/notifications';
import { CarnetPrint, CertificatPrint } from './pages/print';
import { ProfilePage, applyTheme } from './pages/profile';
import { QueuePage } from './pages/queue';
import { StatsPage, VetsPage } from './pages/admin';
import type { Role } from './api/types';

const AUTH_ROUTES = ['/connexion', '/inscription', '/mot-de-passe-oublie'];
const ONLY: Record<string, Role[]> = { '/animaux/nouveau': ['eleveur'], '/marche': ['eleveur', 'particulier'], '/demandes': ['eleveur', 'particulier'], '/stats': ['autorite', 'agent'], '/veterinaires': ['autorite'], '/audit': ['autorite'] };

const allowedMarket = (r?: Role) => r === 'eleveur' || r === 'particulier';

function Routes() {
  const { path } = useLoc();
  const { user } = useAuth();
  const allowed = ONLY[path];
  if (allowed && user && !allowed.includes(user.role)) return <Empty icon="lock" title="Page non disponible pour votre profil" />;
  if (path === '/') return <Home />;
  if (path === '/animaux') return <AnimalsPage />;
  if (path === '/animaux/nouveau') return <NewAnimalPage />;
  const a = match('/animaux/:id', path);
  if (a) return <AnimalPage id={a.id!} key={a.id} />;
  if (path === '/historique') return <HistoryPage />;
  const ar = match('/archives/:id', path);
  if (ar) return <ArchivePage id={ar.id!} key={ar.id} />;
  if (path === '/scan') return <ScanPage />;
  if (path === '/marche') return <MarketPage />;
  const mk = match('/marche/:id', path);
  if (mk) return allowedMarket(user?.role) ? <MarketDetailPage id={mk.id!} key={mk.id} /> : <Empty icon="lock" title="Page non disponible pour votre profil" />;
  if (path === '/demandes') return <RequestsPage />;
  if (path === '/notifications') return <NotificationsPage />;
  const pc = match('/imprimer/carnet/:id', path);
  if (pc) return <CarnetPrint id={pc.id!} key={pc.id} />;
  const pv = match('/imprimer/certificat/:id', path);
  if (pv) return <CertificatPrint id={pv.id!} key={pv.id} />;
  if (path === '/alertes') return <AlertsPage />;
  if (path === '/profil') return <ProfilePage />;
  if (path === '/envoi') return <QueuePage />;
  if (path === '/stats') return <StatsPage />;
  if (path === '/audit') return <AuditPage />;
  if (path === '/veterinaires') return <VetsPage />;
  return <Empty icon="search" title="Page introuvable" />;
}

function Gate() {
  const { user, ready } = useAuth();
  const { path } = useLoc();
  const isAuthRoute = AUTH_ROUTES.includes(path);
  useEffect(() => {
    if (!ready) return;
    if (!user && !isAuthRoute) navigate('/connexion', true);
    else if (user && isAuthRoute) navigate('/', true);
  }, [ready, user, isAuthRoute]);
  useEffect(() => { applyTheme(user?.prefs.theme); }, [user?.prefs.theme]);
  if (!ready) return <div className="center" style={{ padding: '4rem 0' }}><Spinner /></div>;
  if (!user) return path === '/inscription' ? <RegisterPage /> : path === '/mot-de-passe-oublie' ? <ForgotPage /> : path === '/connexion' ? <LoginPage /> : null;
  if (isAuthRoute) return null;
  return <Shell><Routes /></Shell>;
}

export function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
