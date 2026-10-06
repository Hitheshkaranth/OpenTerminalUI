import { afterEach, describe, expect, it } from "vitest";

import { buildScreenContext } from "../agent/screenContext";
import { useSettingsStore } from "../store/settingsStore";

describe("agent screen context with exchange-qualified tickers", () => {
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("reads NSE:CCL as symbol CCL on NSE, even when another market is selected", () => {
    useSettingsStore.setState({ selectedMarket: "NASDAQ" } as never);
    window.history.replaceState({}, "", "/equity/security/NSE:CCL");
    const ctx = buildScreenContext();
    expect(ctx.symbol).toBe("CCL");
    expect(ctx.market).toBe("NSE");
  });

  it("keeps the selected market for a bare ticker", () => {
    useSettingsStore.setState({ selectedMarket: "NYSE" } as never);
    window.history.replaceState({}, "", "/equity/security/CCL");
    const ctx = buildScreenContext();
    expect(ctx.symbol).toBe("CCL");
    expect(ctx.market).toBe("NYSE");
  });
});
