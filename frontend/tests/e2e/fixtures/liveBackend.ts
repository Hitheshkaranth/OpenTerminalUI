import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";

// The shared e2e auth state is a fake (unsigned) JWT, which the real backend
// rejects, and the Vite test server calls the backend cross-origin. Specs that
// must exercise real backend endpoints ("live data") therefore log in a real
// e2e user from Node and proxy only the endpoints under test through Playwright,
// attaching that user's bearer token. The backend route, its computation and the
// upstream market data are all real; only the transport/auth hop is bridged.

const BACKEND_URL =
  process.env.E2E_BACKEND_URL || `http://127.0.0.1:${Number(process.env.E2E_BACKEND_PORT || 8010)}`;
const LIVE_USER = { email: "e2e-live@example.com", password: "e2e-live-password" };
// /api/auth/login is rate limited (5/min), so reuse a still-valid token across workers/runs.
const TOKEN_CACHE = path.join(os.tmpdir(), `openterminalui-e2e-live-token-${new URL(BACKEND_URL).port}.json`);

function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

async function readCachedToken(): Promise<string | null> {
  try {
    const { accessToken } = JSON.parse(await fs.readFile(TOKEN_CACHE, "utf8"));
    const minValidUntil = Math.floor(Date.now() / 1000) + 5 * 60;
    return typeof accessToken === "string" && tokenExpiry(accessToken) > minValidUntil ? accessToken : null;
  } catch {
    return null;
  }
}

export async function liveBackendToken(request: APIRequestContext): Promise<string> {
  const cached = await readCachedToken();
  if (cached) return cached;

  // 409 when the user already exists is expected.
  await request.post(`${BACKEND_URL}/api/auth/register`, { data: LIVE_USER });
  const res = await request.post(`${BACKEND_URL}/api/auth/login`, { data: LIVE_USER });
  if (!res.ok()) {
    throw new Error(`live e2e login failed: ${res.status()} ${await res.text()}`);
  }
  const { access_token: accessToken } = (await res.json()) as { access_token: string };
  await fs.writeFile(TOKEN_CACHE, JSON.stringify({ accessToken }), "utf8");
  return accessToken;
}

/** Route `/api/<prefix>/**` calls from the page to the real backend with a real session. */
export async function proxyToLiveBackend(page: Page, request: APIRequestContext, apiPrefix: string): Promise<void> {
  const token = await liveBackendToken(request);
  await page.route(`**/api/${apiPrefix}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const response = await request.fetch(`${BACKEND_URL}${url.pathname}${url.search}`, {
      method: req.method(),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      data: req.postDataBuffer() ?? undefined,
      timeout: 90_000,
    });
    await route.fulfill({
      status: response.status(),
      headers: { ...response.headers(), "access-control-allow-origin": "*" },
      body: await response.body(),
    });
  });
}
