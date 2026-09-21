/**
 * Global fetch shim: several panels call `fetch("/api/...")` directly instead of the
 * shared axios client, so they never sent the bearer token and silently 401'd
 * (chart data, depth, user layouts, scripting, ETF panels, …). This adds the
 * Authorization header to same-origin API requests that don't already carry one.
 * The axios interceptor in `base.ts` is unaffected.
 */
const ACCESS_TOKEN_KEY = "ot-access-token";

function apiPrefix(): string {
  const base = String(import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");
  return base.startsWith("http") ? base : `${window.location.origin}${base}`;
}

function readToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function installAuthFetch(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const w = window as Window & { __otAuthFetchInstalled?: boolean };
  if (w.__otAuthFetchInstalled) return;
  w.__otAuthFetchInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const absolute = new URL(url, window.location.origin).href;
      if (absolute.startsWith(apiPrefix())) {
        const token = readToken();
        if (token) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (!headers.has("Authorization")) {
            headers.set("Authorization", `Bearer ${token}`);
            return nativeFetch(input, { ...init, headers });
          }
        }
      }
    } catch {
      /* fall through to the native call */
    }
    return nativeFetch(input, init);
  };
}
