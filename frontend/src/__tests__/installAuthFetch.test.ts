import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installAuthFetch } from "../api/installAuthFetch";

describe("installAuthFetch", () => {
  const native = vi.fn(async () => new Response("{}", { status: 200 }));
  beforeEach(() => {
    (window as unknown as { __otAuthFetchInstalled?: boolean }).__otAuthFetchInstalled = false;
    window.fetch = native as unknown as typeof fetch;
    native.mockClear();
    localStorage.setItem("ot-access-token", "tok123");
  });
  afterEach(() => localStorage.clear());

  it("adds the bearer token to same-origin /api requests", async () => {
    installAuthFetch();
    await fetch("/api/chart/AAPL?interval=1d");
    const init = native.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok123");
  });

  it("does not override an explicit Authorization header", async () => {
    installAuthFetch();
    await fetch("/api/x", { headers: { Authorization: "Bearer mine" } });
    const init = native.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer mine");
  });

  it("leaves non-API and cross-origin requests untouched", async () => {
    installAuthFetch();
    await fetch("/favicon.png");
    await fetch("https://example.com/api/other");
    for (const call of native.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.headers ? new Headers(init.headers).get("Authorization") : null).toBeNull();
    }
  });
});
