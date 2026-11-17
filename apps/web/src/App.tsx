import { useEffect } from 'react';
import { RouterProvider, match, navigate, useLoc } from './lib/router';
import { AuthProvider, useAuth } from './ui/auth';
import { ToastProvider, Spinner, Empty } from './ui/kit';
import { Shell } from './ui/shell';
import { LoginPage, RegisterPage } from './pages/auth';
import { Home } from './pages/home';
import { AlertsPage } from './pages/alerts';
import { AnimalsPage, NewAnimalPage } from './pages/animals';
import { AnimalPage } from './pages/animal';
import { ScanPage } from './pages/scan';
import { MarketPage } from './pages/market';
import { ProfilePage, applyTheme } from './pages/profile';
import { QueuePage } from './pages/queue';
import { StatsPage, VetsPage } from './pages/admin';
import type { Role } from './api/types';

const AUTH_ROUTES = ['/connexion', '/inscription'];
const ONLY: Record<string, Role[]> = { '/animaux/nouveau': ['eleveur'], '/marche': ['eleveur'], '/stats': ['autorite', 'agent'], '/veterinaires': ['autorite'] };

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
  if (path === '/scan') return <ScanPage />;
  if (path === '/marche') return <MarketPage />;
  if (path === '/alertes') return <AlertsPage />;
  if (path === '/profil') return <ProfilePage />;
  if (path === '/envoi') return <QueuePage />;
  if (path === '/stats') return <StatsPage />;
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
  if (!user) return path === '/inscription' ? <RegisterPage /> : path === '/connexion' ? <LoginPage /> : null;
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
