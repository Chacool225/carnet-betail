import { api, qs } from '../api/client';
import type { AppNotification, Page } from '../api/types';
import { Badge, Card, Empty, ErrorBox, PageHead, Pager, Spinner, useAction, useQuery } from '../ui/kit';
import { useUrlFilters } from '../ui/filters';
import { Link, navigate } from '../lib/router';
import { dateTime } from '../lib/format';

export function NotificationsPage() {
  const f = useUrlFilters({ unread: '' });
  const list = useQuery(() => api.get<Page<AppNotification> & { unread: number }>(`/me/notifications${qs({ unread: f.values.unread, page: f.page, limit: 20 })}`), [f.values.unread, f.page]);
  const { run } = useAction();
  const open = async (n: AppNotification) => {
    if (!n.read) await api.post(`/me/notifications/${n.id}/read`, {}).catch(() => undefined);
    window.dispatchEvent(new Event('notifications:changed'));
    if (n.link) navigate(n.link); else list.reload();
  };
  const all = async () => { await run(() => api.post('/me/notifications/read-all', {}), 'Tout est lu'); window.dispatchEvent(new Event('notifications:changed')); list.reload(); };
  return (
    <>
      <PageHead title="Notifications" sub={list.data ? `${list.data.unread} non lue(s)` : undefined}>
        <button className="btn" onClick={all} disabled={!list.data?.unread}>Tout marquer comme lu</button>
      </PageHead>
      <div className="seg wide" role="tablist" style={{ marginBottom: '.8rem' }}>
        <button role="tab" aria-selected={!f.values.unread} onClick={() => f.set({ unread: '' })}>Toutes</button>
        <button role="tab" aria-selected={f.values.unread === 'true'} onClick={() => f.set({ unread: 'true' })}>Non lues</button>
      </div>
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox error={list.error} retry={list.reload} /> : (
        <Card>
          {!list.data?.items.length ? <Empty icon="bell" title="Aucune notification">Rappels de vaccins, demandes d'achat et réponses apparaîtront ici.</Empty> : (
            <ul className="rows">
              {list.data.items.map((n) => (
                <li key={n.id}>
                  <button className="row linklike" style={{ width: '100%', textAlign: 'left' }} onClick={() => open(n)}>
                    <div className="grow">{!n.read && <Badge tone="blue">Nouveau</Badge>} <b>{n.title}</b>{n.body && <><br /><span className="mute">{n.body}</span></>}<br /><span className="mute">{dateTime(n.createdAt)}</span></div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.data && <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={f.setPage} />}
        </Card>
      )}
      <p className="mute">Les notifications sont dans l'application. L'envoi par SMS ou WhatsApp demande un compte chez un fournisseur et n'est pas encore branché.</p>
      <p><Link to="/demandes">Voir les demandes d'achat</Link></p>
    </>
  );
}
