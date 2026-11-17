import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AnimalCard } from '../api/types';
import { Badge, Card, ErrorBox, Field, Icon, PageHead, useAction, useToast } from '../ui/kit';
import { useAuth } from '../ui/auth';
import { Link, navigate } from '../lib/router';
import { SPECIES, STATUS, date } from '../lib/format';

declare const BarcodeDetector: any;

/** Extrait le code d'une saisie : code brut, adresse /a/CODE, ou boucle RFID. */
export function parseCode(raw: string): { code?: string; rfid?: string } | null {
  const t = raw.trim();
  if (!t) return null;
  const url = /(?:\/a\/|code=)([A-Za-z0-9-]{5,30})/.exec(t);
  if (url) return { code: url[1]!.toUpperCase() };
  const compact = t.replace(/\s+/g, '');
  if (/^[0-9A-Fa-f]{10,24}$/.test(compact)) return { rfid: compact.toUpperCase() };
  if (/^[A-Za-z0-9-]{5,30}$/.test(compact)) return { code: compact.toUpperCase() };
  return null;
}

function CameraScanner({ onCode }: { onCode: (v: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'idle' | 'on' | 'error'>('idle');
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  useEffect(() => {
    if (state !== 'on') return;
    let stop = false; let stream: MediaStream | undefined; let timer: number | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stop || !video.current) return;
        video.current.srcObject = stream; await video.current.play();
        const det = new BarcodeDetector({ formats: ['qr_code'] });
        const tick = async () => {
          if (stop || !video.current) return;
          try { const r = await det.detect(video.current); if (r[0]?.rawValue) { onCode(r[0].rawValue); return; } } catch { /* image pas prête */ }
          timer = window.setTimeout(tick, 300);
        };
        tick();
      } catch { setState('error'); }
    })();
    return () => { stop = true; if (timer) clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  if (!supported) return <p className="mute">La caméra ne lit pas encore les codes QR sur ce navigateur : saisissez le code écrit sous le QR.</p>;
  return (
    <div className="camera">
      {state === 'on' ? <video ref={video} playsInline muted aria-label="Caméra" /> : <button type="button" className="btn" onClick={() => setState('on')}><Icon name="scan" /> Ouvrir la caméra</button>}
      {state === 'error' && <p className="banner warn">Caméra inaccessible. Autorisez-la dans le navigateur ou saisissez le code.</p>}
    </div>
  );
}

export function ScanPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [card, setCard] = useState<AnimalCard | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const { busy, run } = useAction();
  const isVet = user!.role === 'vet';

  const search = async (raw: string) => {
    const p = parseCode(raw);
    setErr(null); setCard(null);
    if (!p) { toast('Code non reconnu. Exemple : CI-BOV-00001', 'err'); return; }
    try {
      const qsv = p.code ? `code=${encodeURIComponent(p.code)}` : `rfid=${encodeURIComponent(p.rfid!)}`;
      if (isVet) {
        const r = await run(() => api.post<{ animalId: string; stolen: boolean; expiresOn: string }>('/access/scan', p), undefined);
        if (r) { toast(`Accès ouvert jusqu'au ${date(r.expiresOn)}`, 'ok'); navigate(`/animaux/${r.animalId}`); }
        return;
      }
      setCard(await api.get<AnimalCard>(`/animals/lookup?${qsv}`));
    } catch (e) { setErr(e); }
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); void search(text); };

  return (
    <>
      <PageHead title="Scanner un animal" sub={isVet ? 'Scanner ouvre un accès de 30 jours à la fiche.' : 'Retrouvez une fiche avec son code QR ou sa boucle RFID.'} />
      <Card>
        <form className="form" onSubmit={submit}>
          <CameraScanner onCode={(v) => { setText(v); void search(v); }} />
          <Field label="Code sous le QR ou numéro de boucle RFID">
            {(id) => <div className="inline"><input id={id} value={text} onChange={(e) => setText(e.target.value)} className="mono" autoCapitalize="characters" autoComplete="off" placeholder="CI-BOV-00001" /><button className="btn pri" disabled={busy || !text.trim()}>{isVet ? 'Scanner' : 'Chercher'}</button></div>}
          </Field>
        </form>
      </Card>
      {err ? <ErrorBox error={err} /> : null}
      {card && (
        <Card title="Fiche trouvée">
          <div className="row">
            <span className="ico" aria-hidden="true">{SPECIES[card.species].icon}</span>
            <div className="grow"><b>{card.name}</b> <span className="mono mute">{card.code}</span><br /><span className="mute">{SPECIES[card.species].label} · {card.zone} · {card.ownerName}</span></div>
            <Badge tone={STATUS[card.status].tone}>{STATUS[card.status].label}</Badge>
          </div>
          {card.stolen && <p className="banner err" role="alert"><b>Cet animal est déclaré volé.</b> Prévenez l'agent de la zone ou les autorités.</p>}
          {card.access ? <Link to={`/animaux/${card.id}`} className="btn pri">Ouvrir la fiche</Link> : <p className="mute">Vous n'avez pas accès à la fiche détaillée.</p>}
        </Card>
      )}
    </>
  );
}
