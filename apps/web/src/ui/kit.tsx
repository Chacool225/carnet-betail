import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { playPhrase, useLang } from '../i18n';
import { qrSvg } from '../lib/qr';
import { errorText } from '../lib/format';

// ---------- icônes (traits simples, héritent de la couleur du texte) ----------
const P: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  cow: 'M4 8h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8ZM4 8l2-4M20 8l-2-4M9 13h.01M15 13h.01',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
  shop: 'M4 8h16l-1 11H5L4 8ZM8 8a4 4 0 0 1 8 0',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 21h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  chev: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3ZM9 12l2 2 4-4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wifi: 'M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
  off: 'M3 3l18 18M5 12a10 10 0 0 1 4-2.4M15 10a10 10 0 0 1 4 2M8.5 15.5a5 5 0 0 1 4-1.4M12 19h.01',
  sync: 'M20 11a8 8 0 0 0-14.5-3M4 4v4h4M4 13a8 8 0 0 0 14.5 3M20 20v-4h-4',
  logout: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10Z',
  alert: 'M12 4l9 16H3L12 4ZM12 10v4M12 17h.01',
  speaker: 'M4 10v4h4l5 4V6L8 10H4ZM16 9a4 4 0 0 1 0 6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  tag: 'M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01',
  lock: 'M6 11h12v9H6v-9ZM8 11V8a4 4 0 0 1 8 0v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4',
  syringe: 'M18 3l3 3M16 5l3 3M14 7l3 3-8 8-4 1 1-4 8-8ZM5 19l-2 2M11 11l2 2',
  skull: 'M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4 3 5v3h8v-3c1.8-1 3-2.5 3-5a7 7 0 0 0-7-7ZM9.5 11h.01M14.5 11h.01',
  coin: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.500M12 6v2M12 16v2',
  knife: 'M4 20l9-9M13 11l6-6c1 3 0 6-3 8l-3-2ZM4 20l2-5',
  swap: 'M7 7h13l-4-4M17 17H4l4 4',
  image: 'M4 5h16v14H4V5ZM4 16l5-5 4 4 3-3 4 4M9 9h.01',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
};
export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.alert} />
    </svg>
  );
}

// ---------- notifications ----------
interface Toast { id: number; text: string; tone: 'ok' | 'err' | 'info' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = next.current++;
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'err' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- éléments d'interface ----------
export function Badge({ tone = 'grey', children }: { tone?: 'green' | 'amber' | 'red' | 'blue' | 'grey'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return <div className="spin" role="status"><i /> {label}</div>;
}

export function Empty({ icon = 'list', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="errbox" role="alert">
      <b>{errorText(error)}</b>
      {retry && <button className="btn" onClick={retry}>Réessayer</button>}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pagehead">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <header className="cardhead">{title && <h2>{title}</h2>}{actions}</header>}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'red' | 'amber' | 'green'; hint?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</button>
      <span>Page {page} sur {pages}</span>
      <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</button>
    </nav>
  );
}

// ---------- formulaires ----------
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={`field ${error ? 'bad' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && !error && <small>{hint}</small>}
      {error && <small className="err" role="alert">{error}</small>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.close)');
    first?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header><h2>{title}</h2><button className="icon-btn close" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button></header>
        <div className="mbody">{children}</div>
      </div>
    </div>
  );
}

export function QrCode({ text, size = 140 }: { text: string; size?: number }) {
  let svg = '';
  try { svg = qrSvg(text, size); } catch { svg = ''; }
  return <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Mode simple : dit la phrase toute seule à l'ouverture de l'écran (le téléphone ne peut parler qu'après un premier toucher, ce qui est le cas après la connexion). */
export function useAutoSpeak(on: boolean, k: string): void {
  const { lang, t } = useLang();
  useEffect(() => {
    if (!on) return;
    const id = setTimeout(() => playPhrase(lang, k, t(k)), 350);
    return () => { clearTimeout(id); if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); };
  }, [on, k, lang]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Lecture à voix haute (mode simple) : la synthèse vocale du téléphone, si elle existe. */
export function Speak({ text, k }: { text: string; k?: string }) {
  const { lang, t } = useLang();
  const shown = k ? t(k) : text;
  if (typeof window === 'undefined' || (lang === 'fr' && !('speechSynthesis' in window))) return null;
  return (
    <button className="icon-btn speak" aria-label={`${t('common.listen')} : ${shown}`} onClick={(e) => {
      e.preventDefault(); e.stopPropagation();
      playPhrase(lang, k ?? text, shown);
    }}><Icon name="speaker" size={18} /></button>
  );
}

// ---------- chargement de données ----------
export interface Query<T> { data: T | undefined; error: unknown; loading: boolean; reload: () => void; stale?: string }

/** Charge des données quand `deps` change. Ignore les réponses arrivées après un changement de paramètres. */
export function useQuery<T>(load: () => Promise<T | { data: T; stale: boolean; savedAt: string }>, deps: unknown[], opts: { cached?: boolean } = {}): Query<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean; stale?: string }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load().then(
      (r) => {
        if (!live) return;
        if (opts.cached && r && typeof r === 'object' && 'savedAt' in (r as object)) {
          const c = r as { data: T; stale: boolean; savedAt: string };
          setState({ data: c.data, loading: false, stale: c.stale ? c.savedAt : undefined });
        } else setState({ data: r as T, loading: false });
      },
      (error) => { if (live) setState((s) => ({ data: s.data, error, loading: false })); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data: state.data, error: state.error, loading: state.loading, stale: state.stale, reload: () => setTick((t) => t + 1) };
}

/** Exécute une action avec état « en cours » et message d'erreur. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg, 'ok');
      return r;
    } catch (e) {
      toast(errorText(e), 'err');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
