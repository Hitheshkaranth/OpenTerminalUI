const CSRF_COOKIE_NAME = "_csrf_token";

export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getTokenHeader(): Record<string, string> {
  const token = getCsrfToken();
  return token ? { "X-CSRF-Token": token } : {};
}

export function autoInjectCsrf(fetchInit: RequestInit): RequestInit {
  const csrfHeaders = getTokenHeader();
  if (Object.keys(csrfHeaders).length === 0) return fetchInit;
  return {
    ...fetchInit,
    headers: {
      ...(fetchInit.headers as Record<string, string> | undefined) || {},
      ...csrfHeaders,
    },
  };
}

export type CsrfRetryConfig = {
  onCsrfMismatch: () => Promise<string | null>;
};

let csrfRetryConfig: CsrfRetryConfig | null = null;

export function setCsrfRetryHandler(config: CsrfRetryConfig | null): void {
  csrfRetryConfig = config;
}

export async function fetchWithCsrfRetry(url: string, init: RequestInit): Promise<Response> {
  const updatedInit = autoInjectCsrf(init);
  const response = await fetch(url, updatedInit);

  if (response.status === 403 && csrfRetryConfig) {
    const newToken = await csrfRetryConfig.onCsrfMismatch();
    if (newToken) {
      return fetch(url, autoInjectCsrf(init));
    }
  }
  return response;
}