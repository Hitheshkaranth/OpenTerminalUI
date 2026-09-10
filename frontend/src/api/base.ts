import axios from "axios";

import { getTokenHeader } from "../lib/csrf";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30000,
});

let accessTokenGetter: (() => string | null) | null = null;

export function setAccessTokenGetter(getter: (() => string | null) | null): void {
  accessTokenGetter = getter;
}

export function getAccessToken(): string | null {
  return accessTokenGetter ? accessTokenGetter() : null;
}

// Refresh handler registered by AuthContext: performs a token refresh and
// resolves with the new access token (or null if refresh failed / unavailable).
type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;

export function setRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler;
}

// Coalesce concurrent refreshes so a burst of 401s triggers only one refresh.
let refreshInFlight: Promise<string | null> | null = null;

api.interceptors.request.use((config) => {
  // A refresh-retry already carries a fresh Authorization header; don't clobber it.
  const headers = config.headers as Record<string, string> | undefined;
  if ((config as { __isRetry?: boolean }).__isRetry && headers?.Authorization) {
    return config;
  }
  const token = accessTokenGetter ? accessTokenGetter() : null;
  if (token) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  if (["POST", "PUT", "DELETE", "PATCH"].includes((config.method || "").toUpperCase())) {
    const csrfHeaders = getTokenHeader();
    if (config.headers) {
      Object.assign(config.headers, csrfHeaders);
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const config = error?.config as
      | (Record<string, unknown> & { __isRetry?: boolean; headers?: Record<string, string> })
      | undefined;
    if (status === 401 && refreshHandler && config && !config.__isRetry) {
      try {
        refreshInFlight = refreshInFlight ?? refreshHandler();
        const newToken = await refreshInFlight;
        refreshInFlight = null;
        if (newToken) {
          config.__isRetry = true;
          config.headers = { ...(config.headers || {}), Authorization: `Bearer ${newToken}` };
          return api.request(config);
        }
      } catch {
        refreshInFlight = null;
      }
    }
    if (status === 403 && config && !config.__isRetry) {
      const method = String((config as { method?: string }).method || "");
      if (["POST", "PUT", "DELETE", "PATCH"].includes(method.toUpperCase())) {
        config.__isRetry = true;
        const csrfHeaders = getTokenHeader();
        if (config.headers) {
          Object.assign(config.headers, csrfHeaders);
        }
        return api.request(config);
      }
    }
    return Promise.reject(error);
  },
);

export function extractApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail.trim();
    }
    if (Array.isArray(detail) && detail.length) {
      return detail.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("; ");
    }
    if (typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}
