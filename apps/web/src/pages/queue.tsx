import { useEffect, useState } from 'react';
import { flushQueue, queue } from '../api/offline';
import { Badge, Card, Empty, PageHead, useAction, useToast } from '../ui/kit';
import { dateTime, errorText } from '../lib/format';

export function QueuePage() {
  const toast = useToast();
  const [items, setItems] = useState(queue.list());
  const { busy, run } = useAction();
  useEffect(() => queue.subscribe(() => setItems(queue.list())), []);
  const pending = items.filter((o) => o.status === 'pending');
  const rejected = items.filter((o) => o.status === 'rejected');
  const send = async () => {
    const r = await run(() => flushQueue());
    if (r) toast(r.sent || r.rejected ? `${r.sent} envoyée(s), ${r.rejected} refusée(s)` : pending.length ? 'Pas de réseau pour le moment.' : 'Rien à envoyer.', r.rejected ? 'err' : 'info');
  };
  return (
    <>
      <PageHead title="Envois en attente" sub="Ce que vous avez saisi sans réseau part ici, une seule fois, dès que la connexion revient.">
        <button className="btn pri" onClick={send} disabled={busy || !pending.length}>Envoyer maintenant</button>
      </PageHead>
      <Card title={`À envoyer (${pending.length})`}>
        {!pending.length ? <Empty icon="check" title="Tout est envoyé" /> : (
          <ul className="rows">{pending.map((o) => <li key={o.clientId} className="row"><div className="grow"><b>{o.label}</b><br /><span className="mute">saisi le {dateTime(o.createdAt)}</span></div><Badge tone="amber">En attente</Badge><button className="btn sm" onClick={() => queue.remove(o.clientId)}>Annuler</button></li>)}</ul>
        )}
      </Card>
      {rejected.length > 0 && (
        <Card title={`Refusées par le serveur (${rejected.length})`} actions={<button className="btn sm" onClick={() => queue.clearRejected()}>Tout effacer</button>}>
          <p className="mute">Ces saisies ne peuvent pas être enregistrées. Corrigez-les et refaites-les.</p>
          <ul className="rows">{rejected.map((o) => <li key={o.clientId} className="row"><div className="grow"><b>{o.label}</b><br /><span className="err-text">{o.error ? errorText(o.error) : 'Refusée'}</span></div><button className="btn sm" onClick={() => queue.remove(o.clientId)}>Effacer</button></li>)}</ul>
        </Card>
      )}
    </>
  );
}
