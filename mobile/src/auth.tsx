import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { api, Me, setToken } from './api';
import { storage } from './platform';

const KEY = 'rentathing.token';

interface AuthState {
  user: Me | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (b: { name: string; email: string; password: string; neighborhood: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: Me) => void;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const saved = await storage.get(KEY);
        if (saved) {
          setToken(saved);
          setUser(await api.me());
        }
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const accept = async (r: { access_token: string; user: Me }) => {
    setToken(r.access_token);
    // Remembering the login is a convenience: if secure storage fails, stay logged in for this session.
    await storage.set(KEY, r.access_token).catch(() => {});
    setUser(r.user);
  };

  const signIn = useCallback(async (email: string, password: string) => accept(await api.login(email, password)), []);
  const signUp = useCallback(
    async (b: { name: string; email: string; password: string; neighborhood: string }) => accept(await api.register(b)),
    [],
  );
  const signOut = useCallback(async () => {
    setToken(null);
    await storage.remove(KEY).catch(() => {});
    setUser(null);
  }, []);
  const refresh = useCallback(async () => setUser(await api.me()), []);

  return <Ctx.Provider value={{ user, loading, signIn, signUp, signOut, refresh, setUser }}>{children}</Ctx.Provider>;
}
