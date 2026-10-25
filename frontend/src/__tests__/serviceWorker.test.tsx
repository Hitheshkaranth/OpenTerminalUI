import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import workerSource from "../../public/sw.js?raw";
import { usePWA } from "../hooks/usePWA";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("unregisters only this app's worker and removes only its caches in development", async () => {
  vi.stubEnv("DEV", true);
  const own = { active: { scriptURL: `${window.location.origin}/sw.js` }, unregister: vi.fn() };
  const other = { active: { scriptURL: `${window.location.origin}/other/sw.js` }, unregister: vi.fn() };
  const register = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: { register, getRegistrations: vi.fn().mockResolvedValue([own, other]) } });
  const remove = vi.fn();
  vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue(["otui-static-v5", "other-app"]), delete: remove });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const { result } = renderHook(usePWA);
  await waitFor(() => expect(result.current.isReady).toBe(true));
  expect(register).not.toHaveBeenCalled();
  expect(own.unregister).toHaveBeenCalledOnce();
  expect(other.unregister).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledExactlyOnceWith("otui-static-v5");
});

it("still registers the worker in production", async () => {
  vi.stubEnv("DEV", false);
  const register = vi.fn().mockResolvedValue({ active: {} });
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const { result } = renderHook(usePWA);
  await waitFor(() => expect(result.current.isReady).toBe(true));
  expect(register).toHaveBeenCalledWith("/sw.js");
});

it("bypasses development modules and APIs while retaining cache-first production assets", async () => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const cached = { cached: true };
  const match = vi.fn().mockResolvedValue(cached);
  const put = vi.fn();
  const cache = { match, open: vi.fn().mockResolvedValue({ put }) };
  const response = { ok: true, headers: { get: () => "application/javascript" }, clone: () => response };
  const fetch = vi.fn().mockResolvedValue(response);
  new Function("self", "caches", "fetch", "URL", workerSource)(
    { location: { origin: "https://terminal.test" }, addEventListener: (name: string, cb: (event: unknown) => void) => { listeners[name] = cb; } }, cache, fetch, URL,
  );
  const request = (path: string, respondWith: (response: Promise<unknown>) => void) => listeners.fetch({
    request: { method: "GET", url: `https://terminal.test${path}`, mode: "cors", headers: { get: () => null } }, respondWith,
  });
  const intercept = vi.fn();
  for (const path of ["/src/App.tsx?t=1", "/@vite/client", "/@react-refresh", "/@id/virtual:x", "/@fs/tmp/app.ts", "/node_modules/.vite/deps/react.js", "/api/quotes", "/health"]) request(path, intercept);
  expect(intercept).not.toHaveBeenCalled();
  let result: Promise<unknown> | undefined;
  request("/assets/index-abc123.js", (value) => { result = value; });
  expect(await result).toBe(cached);
  expect(fetch).not.toHaveBeenCalled();
  match.mockResolvedValue(undefined);
  request("/assets/index-def456.js", (value) => { result = value; });
  expect(await result).toBe(response);
  await Promise.resolve();
  expect(put).toHaveBeenCalled();
});
