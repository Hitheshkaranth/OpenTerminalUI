import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiFetch, setAccessTokenGetter, setRefreshHandler } from "../api/base";

describe("native API transport", () => {
  const baseURL = api.defaults.baseURL;
  beforeEach(() => { setAccessTokenGetter(() => "test-access-token"); setRefreshHandler(null); });
  afterEach(() => { api.defaults.baseURL = baseURL; setAccessTokenGetter(null); setRefreshHandler(null); vi.unstubAllGlobals(); document.cookie = "_csrf_token=; max-age=0; path=/"; });
  it("authenticates data requests and carries CSRF on mutations", async () => {
    document.cookie = "_csrf_token=test-csrf; path=/";
    const fetcher = vi.fn(async (_input, init) => {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-access-token");
      expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("test-csrf");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    await apiFetch("/api/scripting/save", { method: "POST", body: "{}" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["https://attacker.invalid/api/quotes", "//attacker.invalid/api/quotes", "/api/../outside", "javascript:alert(1)"])("refuses unsafe authenticated destinations: %s", async (url) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(apiFetch(url)).rejects.toThrow("outside the configured API");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refreshes an expired token once and retries using the new header", async () => {
    const seen: string[] = [];
    const refresh = vi.fn(async () => "new-access-token");
    setRefreshHandler(refresh);
    vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
      seen.push(new Headers(init.headers).get("Authorization")!);
      return new Response("{}", { status: seen.length === 1 ? 401 : 200 });
    }));
    expect((await apiFetch("/api/commodities/quotes")).status).toBe(200);
    expect(seen).toEqual(["Bearer test-access-token", "Bearer new-access-token"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("honors a separately hosted configured API without sending auth to the frontend", async () => {
    api.defaults.baseURL = "https://api.example.test/api";
    const fetcher = vi.fn(async () => new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await apiFetch("/api/backtests/run/analytics");
    expect(fetcher.mock.calls[0][0]).toBe("https://api.example.test/api/backtests/run/analytics");
  });
});
