import { afterEach, describe, expect, it } from "vitest";

import { setAccessTokenGetter } from "../api/base";
import { withWsAuth } from "../realtime/wsAuth";
import { alertsWsUrl } from "../hooks/useAlerts";

describe("WebSocket auth token", () => {
  afterEach(() => {
    setAccessTokenGetter(null);
    localStorage.clear();
  });

  it("appends the live access token", () => {
    setAccessTokenGetter(() => "live.jwt.token");
    expect(withWsAuth("ws://host/api/ws/quotes")).toBe("ws://host/api/ws/quotes?token=live.jwt.token");
    expect(withWsAuth("ws://host/x?a=1")).toBe("ws://host/x?a=1&token=live.jwt.token");
  });

  it("falls back to the persisted access token", () => {
    localStorage.setItem("ot-access-token", "stored.jwt");
    expect(withWsAuth("/api/ws/alerts")).toBe("/api/ws/alerts?token=stored.jwt");
  });

  it("leaves the URL untouched when signed out", () => {
    expect(withWsAuth("/api/ws/depth")).toBe("/api/ws/depth");
  });

  it("alerts socket URL carries the token", () => {
    setAccessTokenGetter(() => "abc");
    expect(alertsWsUrl()).toMatch(/\/ws\/alerts\?token=abc$/);
  });
});
