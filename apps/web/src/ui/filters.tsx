import { useEffect, useState, type ReactNode } from 'react';
import { Icon, useDebounced } from './kit';
import { navigate, useLoc } from '../lib/router';
import { daysAgoIso, todayIso } from '../lib/format';

/**
 * Filtres conservés dans l'adresse de la page (« #/animaux?q=vache&from=2026-01-01 ») :
 * le bouton « retour » les retrouve, et une page filtrée peut être partagée ou mise en favori.
 * La page revient à 1 dès qu'un filtre change.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const { path, query } = useLoc();
  const values = { ...defaults } as Record<string, string>;
  for (const k of Object.keys(defaults)) { const v = query.get(k); if (v !== null) values[k] = v; }
  const page = Math.max(1, Number(query.get('page')) || 1);
  const write = (next: Record<string, string>, p: number) => {
    const sp = new URLSearchParams();
    for (const k of Object.keys(defaults)) if (next[k] && next[k] !== defaults[k]) sp.set(k, next[k]!);
    // une valeur vide qui diffère d'un défaut non vide doit survivre (ex. « tous les statuts »)
    for (const k of Object.keys(defaults)) if (!next[k] && defaults[k]) sp.set(k, '');
    if (p > 1) sp.set('page', String(p));
    const s = sp.toString();
    navigate(`${path}${s ? `?${s}` : ''}`, true);
  };
  return {
    values: values as T,
    page,
    set: (patch: Partial<T>) => write({ ...values, ...(patch as Record<string, string>) }, 1),
    setPage: (p: number) => write(values, p),
    reset: () => write({ ...defaults } as Record<string, string>, 1),
    /** Nombre de filtres différents de leur valeur par défaut (la page et le tri ne comptent pas). */
    active: (ignore: string[] = []) => Object.keys(defaults).filter((k) => !ignore.includes(k) && values[k] !== defaults[k]).length,
  };
}

/** Champ de recherche qui n'écrit dans l'adresse qu'après une courte pause de frappe. */
export function SearchBox({ value, onChange, placeholder = 'Rechercher…', label = 'Rechercher' }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const [local, setLocal] = useState(value);
  const d = useDebounced(local, 350);
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => { if (d !== value) onChange(d); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [d]);
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input type="search" aria-label={label} placeholder={placeholder} value={local} onChange={(e) => setLocal(e.target.value)} />
    </div>
  );
}

/** Période précise : deux dates et des raccourcis (7 jours, 30 jours, 1 an). */
export function DateRange({ from, to, onChange, label = 'Période', max = todayIso() }: { from: string; to: string; onChange: (from: string, to: string) => void; label?: string; max?: string | undefined }) {
  const preset = (days: number) => () => onChange(daysAgoIso(days), todayIso());
  return (
    <fieldset className="daterange">
      <legend>{label}</legend>
      <label>Du <input type="date" aria-label={`${label} : du`} value={from} max={to || max} onChange={(e) => onChange(e.target.value, to)} /></label>
      <label>au <input type="date" aria-label={`${label} : au`} value={to} min={from || undefined} max={max} onChange={(e) => onChange(from, e.target.value)} /></label>
      <span className="chips">
        <button type="button" className="chip" onClick={preset(7)}>7 jours</button>
        <button type="button" className="chip" onClick={preset(30)}>30 jours</button>
        <button type="button" className="chip" onClick={preset(365)}>1 an</button>
        {(from || to) && <button type="button" className="chip" onClick={() => onChange('', '')}>Effacer</button>}
      </span>
    </fieldset>
  );
}

/** Zone repliable pour les filtres avancés, avec le nombre de filtres actifs. */
export function MoreFilters({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(count > 0);
  return (
    <div className="morefilters">
      <button type="button" className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="list" size={16} /> Plus de filtres{count > 0 ? ` (${count})` : ''}
      </button>
      {open && <div className="filters adv">{children}</div>}
    </div>
  );
}

export function ResetFilters({ count, onReset }: { count: number; onReset: () => void }) {
  if (!count) return null;
  return <button type="button" className="btn sm" onClick={onReset}>Effacer les filtres ({count})</button>;
}
