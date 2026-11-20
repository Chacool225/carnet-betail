import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './kit';
import { useAuth } from './auth';
import { Link, useLoc } from '../lib/router';
import { queue, flushQueue } from '../api/offline';
import { api } from '../api/client';
import type { Role } from '../api/types';
import { LangPicker, useLang, type Key } from '../i18n';

const NAV: Record<Role, { to: string; label: Key; icon: string }[]> = {
  eleveur: [
    { to: '/', label: 'nav.home', icon: 'home' }, { to: '/animaux', label: 'nav.animals', icon: 'cow' }, { to: '/scan', label: 'nav.scan', icon: 'scan' },
    { to: '/marche', label: 'nav.market', icon: 'shop' }, { to: '/alertes', label: 'nav.alerts', icon: 'bell' },
    { to: '/historique', label: 'nav.history', icon: 'list' },
  ],
  vet: [
    { to: '/', label: 'nav.home', icon: 'home' }, { to: '/scan', label: 'nav.scan', icon: 'scan' }, { to: '/animaux', label: 'nav.access', icon: 'cow' },
    { to: '/alertes', label: 'nav.alerts', icon: 'bell' }, { to: '/historique', label: 'nav.history', icon: 'list' },
  ],
  agent: [
    { to: '/', label: 'nav.zone', icon: 'home' }, { to: '/animaux', label: 'nav.animals', icon: 'cow' }, { to: '/scan', label: 'nav.scan', icon: 'scan' },
    { to: '/alertes', label: 'nav.alerts', icon: 'bell' }, { to: '/historique', label: 'nav.history', icon: 'list' },
  ],
  particulier: [
    { to: '/', label: 'nav.home', icon: 'home' }, { to: '/marche', label: 'nav.market', icon: 'shop' }, { to: '/demandes', label: 'nav.requests', icon: 'list' },
    { to: '/animaux', label: 'nav.myAnimals', icon: 'cow' }, { to: '/historique', label: 'nav.history', icon: 'list' },
  ],
  autorite: [
    { to: '/', label: 'nav.home', icon: 'home' }, { to: '/stats', label: 'nav.stats', icon: 'chart' }, { to: '/alertes', label: 'nav.alerts', icon: 'bell' },
    { to: '/veterinaires', label: 'nav.vets', icon: 'shield' }, { to: '/animaux', label: 'nav.animals', icon: 'cow' },
    { to: '/audit', label: 'nav.audit', icon: 'list' },
  ],
};

function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

/** Nombre de notifications non lues : relu toutes les minutes et dès qu'une page en lit. */
function useUnread(enabled: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => { api.get<{ unread: number }>('/me/notifications?limit=1').then((r) => { if (live) setN(r.unread); }).catch(() => undefined); };
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('notifications:changed', load);
    return () => { live = false; clearInterval(t); window.removeEventListener('notifications:changed', load); };
  }, [enabled]);
  return n;
}

function usePending(): number {
  const [n, setN] = useState(() => queue.pending().length);
  useEffect(() => queue.subscribe(() => setN(queue.pending().length)), []);
  return n;
}

export function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useLang();
  const { path } = useLoc();
  const online = useOnline();
  const pending = usePending();
  const unread = useUnread(!!user && online);

  // Envoi automatique de la file : au retour du réseau, au démarrage, puis toutes les 30 s tant qu'il reste quelque chose.
  useEffect(() => {
    if (!online || !user) return;
    void flushQueue();
    const t = setInterval(() => { if (queue.pending().length) void flushQueue(); }, 30_000);
    return () => clearInterval(t);
  }, [online, user]);

  if (!user) return null;
  const nav = NAV[user.role];
  const active = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));
  return (
    <div className={`app ${user.prefs.simple ? 'simple' : ''}`}>
      <header className="top">
        <Link to="/" className="logo"><i><Icon name="heart" size={18} /></i> {t('app.name')}</Link>
        <span className="grow" />
        <Link to="/envoi" className={`netchip ${online ? '' : 'off'}`} aria-label={online ? t('shell.online') : t('shell.offline')}>
          <span className="dot" /> <span className="hide-sm">{online ? t('shell.online') : t('shell.offline')}</span>
          {pending > 0 && <b className="count" aria-label={`${pending} à envoyer`}>{pending}</b>}
        </Link>
        <LangPicker compact />
        <Link to="/notifications" className="icon-btn bell" aria-label={unread ? `${t('shell.notifications')} : ${unread}` : t('shell.notifications')}><Icon name="bell" />{unread > 0 && <b className="count">{unread > 9 ? '9+' : unread}</b>}</Link>
        <Link to="/profil" className="icon-btn" aria-label={t('shell.profile')}><Icon name="user" /></Link>
      </header>
      <div className="body">
        <nav className="side" aria-label="Navigation">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} aria-current={active(n.to) ? 'page' : undefined}><Icon name={n.icon} /> {t(n.label)}</Link>
          ))}
          <span className="foot">{user.name}<br />{t(`role.${user.role}`)}{user.zone ? ` · ${user.zone.name}` : ''}</span>
        </nav>
        <main><div className="wrap">{!online && <div className="banner off" role="status">{t('shell.offlineBanner')}</div>}{children}</div></main>
      </div>
      <nav className="bar" aria-label="Navigation">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} aria-current={active(n.to) ? 'page' : undefined}><Icon name={n.icon} /><span>{t(n.label)}</span></Link>
        ))}
      </nav>
    </div>
  );
}
