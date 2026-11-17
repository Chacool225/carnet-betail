import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, clearCache, clearSession, hasStoredSession, refreshSession, setSession, setSessionLostHandler, NetworkError, store } from '../api/client';
import type { AuthResult, User } from '../api/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  login(identifier: string, password: string): Promise<void>;
  pinLogin(phone: string, pin: string): Promise<void>;
  register(body: Record<string, unknown>): Promise<void>;
  logout(): Promise<void>;
  setUser(u: User): void;
}
const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

const USER_KEY = 'carnet.user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    if (u) store.set(USER_KEY, JSON.stringify(u)); else store.del(USER_KEY);
  }, []);
  const accept = useCallback((r: AuthResult) => { setSession(r); setUser(r.user); }, [setUser]);

  useEffect(() => {
    setSessionLostHandler(() => setUser(null));
    (async () => {
      if (hasStoredSession()) {
        if (await refreshSession()) {
          try { setUser(await api.get<User>('/me')); } catch { /* le profil se rechargera */ }
        } else {
          // pas de réseau : on garde la session et le dernier profil connu, l'app reste utilisable hors-ligne
          const raw = store.get(USER_KEY);
          if (raw && hasStoredSession()) { try { setUserState(JSON.parse(raw)); } catch { /* ignoré */ } }
        }
      }
      setReady(true);
    })();
  }, [setUser]);

  const value: AuthState = {
    user, ready, setUser,
    async login(identifier, password) { accept(await api.post<AuthResult>('/auth/login', { identifier, password })); },
    async pinLogin(phone, pin) { accept(await api.post<AuthResult>('/auth/pin-login', { phone, pin })); },
    async register(body) { accept(await api.post<AuthResult>('/auth/register', body)); },
    async logout() {
      const rt = store.get('carnet.refresh');
      if (rt) { try { await api.post('/auth/logout', { refreshToken: rt }); } catch (e) { if (!(e instanceof NetworkError)) { /* la session locale est fermée quand même */ } } }
      clearSession(); clearCache(); setUser(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
