import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

/** Routeur minimal par « # » : fonctionne sans configuration serveur et sur un hébergement statique. */
const parse = () => {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { path: path || '/', query: new URLSearchParams(query) };
};

export interface Loc { path: string; query: URLSearchParams }
const Ctx = createContext<Loc>({ path: '/', query: new URLSearchParams() });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<Loc>(parse);
  useEffect(() => {
    const on = () => { setLoc(parse()); window.scrollTo?.(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return <Ctx.Provider value={loc}>{children}</Ctx.Provider>;
}

export const useLoc = () => useContext(Ctx);
export const navigate = (to: string, replace = false) => {
  if (replace) window.location.replace(`#${to}`);
  else window.location.hash = to;
};
export const back = () => window.history.back();

export function Link({ to, children, ...rest }: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return <a href={`#${to}`} {...rest}>{children}</a>;
}

/** Compare un chemin à un motif « /animaux/:id » ; renvoie les paramètres ou null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean), b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
