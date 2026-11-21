import { getAccessToken } from "../api/base";

const ACCESS_TOKEN_STORAGE_KEY = "ot-access-token";

/** Current access token for WebSocket auth: the live AuthContext token, falling
 * back to the persisted one (sockets can open before AuthContext registers). */
export function getWsAccessToken(): string | null {
  const live = getAccessToken();
  if (live) return live;
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Append `?token=<access token>` to a WebSocket URL. The backend closes
 * sockets without a valid access token with code 4401. */
export function withWsAuth(url: string): string {
  const token = getWsAccessToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
