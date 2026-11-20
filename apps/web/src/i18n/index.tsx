// Langues de l'application. Le français est la langue de référence (fr.json) : toute clé sans traduction s'affiche en français.
// Les traductions dioula et baoulé se remplissent dans translations.csv puis `pnpm --filter @carnet/web i18n:import` (voir LANGUES.md).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { store } from '../api/client';
import fr from './fr.json';
import dyu from './dyu.json';
import bci from './bci.json';

export type Lang = 'fr' | 'dyu' | 'bci';
export type Key = keyof typeof fr;
type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = { fr: fr as Dict, dyu: dyu as Dict, bci: bci as Dict };
export const LANGS: { code: Lang; label: string; htmlLang: string }[] = [
  { code: 'fr', label: 'Français', htmlLang: 'fr' },
  { code: 'dyu', label: 'Dioula', htmlLang: 'dyu' },
  { code: 'bci', label: 'Baoulé', htmlLang: 'bci' },
];

/** Part des textes traduits (0 à 100). Le français vaut toujours 100. */
export function coverage(lang: Lang): number {
  if (lang === 'fr') return 100;
  const total = Object.keys(fr).length;
  const done = Object.keys(fr).filter((k) => (DICTS[lang][k] ?? '').trim()).length;
  return Math.round((done * 100) / total);
}
/** Une langue n'est proposée que si elle a au moins une traduction. */
export const available = (lang: Lang) => coverage(lang) > 0;

export function translate(lang: Lang, key: Key | string, vars?: Record<string, string | number>): string {
  const raw = (DICTS[lang][key] ?? '').trim() || (DICTS.fr[key] ?? String(key));
  return vars ? raw.replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? `{${v}}`)) : raw;
}

interface LangState { lang: Lang; setLang(l: Lang): void; t(key: Key | string, vars?: Record<string, string | number>): string }
const Ctx = createContext<LangState>({ lang: 'fr', setLang: () => undefined, t: (k, v) => translate('fr', k, v) });
export const useLang = () => useContext(Ctx);

const KEY = 'carnet.lang';
const initial = (): Lang => { const s = store.get(KEY) as Lang | null; return s && DICTS[s] && available(s) ? s : 'fr'; };

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => { if (!available(l)) return; setLangState(l); store.set(KEY, l); }, []);
  useEffect(() => { document.documentElement.lang = LANGS.find((l) => l.code === lang)?.htmlLang ?? 'fr'; }, [lang]);
  const value = useMemo<LangState>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Choix de la langue. Une langue sans traduction est grisée avec la mention « bientôt ». */
export function LangPicker({ compact }: { compact?: boolean }) {
  const { lang, setLang, t } = useLang();
  return (
    <label className={`langpick ${compact ? 'compact' : ''}`}>
      <span className={compact ? 'vh' : 'mute'}>{t('common.language')}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('common.language')}>
        {LANGS.map((l) => {
          const ok = available(l.code), c = coverage(l.code);
          return <option key={l.code} value={l.code} disabled={!ok}>{l.label}{ok ? (c < 100 ? ` · ${c} %` : '') : ' · bientôt'}</option>;
        })}
      </select>
    </label>
  );
}

/** Lecture à voix haute : un enregistrement `public/audio/<langue>/<clé>.mp3` s'il existe, sinon la voix française du téléphone. */
export function playPhrase(lang: Lang, key: string, fallbackText: string): void {
  const frSpeak = () => {
    if (lang !== 'fr' || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(fallbackText); u.lang = 'fr-FR'; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  };
  if (lang === 'fr') return frSpeak();
  const a = new Audio(`/audio/${lang}/${key}.mp3`);
  a.play().catch(() => { /* pas d'enregistrement pour cette phrase : on ne lit pas de français avec un accent de synthèse */ });
}
