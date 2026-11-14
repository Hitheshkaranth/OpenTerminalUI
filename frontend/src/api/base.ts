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

/** Fetch transport for pages that need a native Response (downloads/streams).
 * Keep the same auth and CSRF boundary as the Axios client, and never forward
 * a bearer token to a caller-supplied external origin or outside the API path.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const base = new URL(String(api.defaults.baseURL || "/api"), origin);
  const requestUrl = input.startsWith("/api/") && base.origin !== origin
    ? `${base.href.replace(/\/$/, "")}${input.slice(4)}` : input;
  const target = new URL(requestUrl, origin);
  const prefix = base.pathname.replace(/\/$/, "");
  if (target.origin !== base.origin || (target.pathname !== prefix && !target.pathname.startsWith(`${prefix}/`))) {
    throw new Error("Refusing an authenticated request outside the configured API.");
  }
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (["POST", "PUT", "PATCH", "DELETE"].includes((init.method || "GET").toUpperCase())) {
    for (const [name, value] of Object.entries(getTokenHeader())) headers.set(name, value);
  }
  const response = await fetch(requestUrl, { ...init, headers });
  if (response.status !== 401 || !refreshHandler) return response;
  if (!refreshInFlight) refreshInFlight = refreshHandler().catch(() => null).finally(() => { refreshInFlight = null; });
  const freshToken = await refreshInFlight;
  if (!freshToken) return response;
  headers.set("Authorization", `Bearer ${freshToken}`);
  return fetch(requestUrl, { ...init, headers });
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
