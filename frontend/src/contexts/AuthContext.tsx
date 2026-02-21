import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

import { setAccessTokenGetter } from "../api/client";
import { setAccessTokenGetter as setQuantAccessTokenGetter } from "../api/quantClient";
import { setAccessTokenGetter as setFnoAccessTokenGetter } from "../fno/api/fnoApi";

export type AuthRole = "admin" | "trader" | "viewer";

type AuthUser = {
  id: string;
  email: string;
  role: AuthRole;
};

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role?: AuthRole) => Promise<void>;
  logout: () => void;
  hasRole: (required: AuthRole) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const ACCESS_TOKEN_KEY = "ot-access-token";
const REFRESH_TOKEN_KEY = "ot-refresh-token";

function parseJwtExp(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

function parseJwtUser(token: string | null): AuthUser | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized));
    if (!decoded.sub || !decoded.email || !decoded.role) return null;
    return {
      id: String(decoded.sub),
      email: String(decoded.email),
      role: String(decoded.role) as AuthRole,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const refreshTimerRef = useRef<number | null>(null);

  const authApi = useMemo(
    () =>
      axios.create({
        baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
        timeout: 30000,
      }),
    [],
  );

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current != null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const logout = useCallback(() => {
    clearRefreshTimer();
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }, [clearRefreshTimer]);

  const performRefresh = useCallback(async () => {
    if (!refreshToken) return;
    try {
      const { data } = await authApi.post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/refresh", {
        refresh_token: refreshToken,
      });
      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      setUser(parseJwtUser(data.access_token));
      localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    } catch {
      logout();
    }
  }, [authApi, logout, refreshToken]);

  const scheduleRefresh = useCallback(
    (token: string | null) => {
      clearRefreshTimer();
      const exp = parseJwtExp(token);
      if (!exp) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const inSec = Math.max(5, exp - nowSec - 60);
      refreshTimerRef.current = window.setTimeout(() => {
        void performRefresh();
      }, inSec * 1000);
    },
    [clearRefreshTimer, performRefresh],
  );

  useEffect(() => {
    const storedAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const storedUser = parseJwtUser(storedAccessToken);
    const accessExp = parseJwtExp(storedAccessToken);
    const now = Math.floor(Date.now() / 1000);

    if (storedAccessToken && storedUser && accessExp && accessExp > now) {
      setAccessToken(storedAccessToken);
      setRefreshToken(storedRefreshToken);
      setUser(storedUser);
      setIsInitializing(false);
      return;
    }

    if (!storedRefreshToken) {
      setIsInitializing(false);
      return;
    }

    setRefreshToken(storedRefreshToken);
    void authApi
      .post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/refresh", {
        refresh_token: storedRefreshToken,
      })
      .then(({ data }) => {
        setAccessToken(data.access_token);
        setRefreshToken(data.refresh_token);
        setUser(parseJwtUser(data.access_token));
        localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
      })
      .catch(() => {
        logout();
      })
      .finally(() => {
        setIsInitializing(false);
      });
  }, [authApi, logout]);

  useEffect(() => {
    setAccessTokenGetter(() => accessToken);
    setQuantAccessTokenGetter(() => accessToken);
    setFnoAccessTokenGetter(() => accessToken);
    scheduleRefresh(accessToken);
    return () => {
      setAccessTokenGetter(null);
      setQuantAccessTokenGetter(null);
      setFnoAccessTokenGetter(null);
      clearRefreshTimer();
    };
  }, [accessToken, clearRefreshTimer, scheduleRefresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      try {
        const { data } = await authApi.post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/login", {
          email,
          password,
        });
        setAccessToken(data.access_token);
        setRefreshToken(data.refresh_token);
        setUser(parseJwtUser(data.access_token));
        localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
      } finally {
        setIsLoading(false);
      }
    },
    [authApi],
  );

  const register = useCallback(
    async (email: string, password: string, role: AuthRole = "viewer") => {
      setIsLoading(true);
      try {
        await authApi.post("/auth/register", { email, password, role });
      } finally {
        setIsLoading(false);
      }
    },
    [authApi],
  );

  const hasRole = useCallback(
    (required: AuthRole) => {
      if (!user) return false;
      const rank: Record<AuthRole, number> = { viewer: 1, trader: 2, admin: 3 };
      return rank[user.role] >= rank[required];
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isAuthenticated: Boolean(accessToken && user),
      isLoading,
      isInitializing,
      login,
      register,
      logout,
      hasRole,
    }),
    [accessToken, hasRole, isInitializing, isLoading, login, logout, register, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
