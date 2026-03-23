/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("settingsStore recent securities", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("persists a 20-item recent-security ring buffer and moves duplicates to the front", async () => {
    const { useSettingsStore } = await import("../store/settingsStore");

    for (let index = 0; index < 21; index += 1) {
      useSettingsStore.getState().addRecentSecurity({
        symbol: `sym${index}`,
        name: `Security ${index}`,
        assetClass: "equity",
        market: "US",
        visitedAt: index,
      });
    }

    useSettingsStore.getState().addRecentSecurity({
      symbol: "sym5",
      name: "Security 5 updated",
      assetClass: "equity",
      market: "US",
      visitedAt: 9999,
    });

    const recent = useSettingsStore.getState().recentSecurities;
    expect(recent).toHaveLength(20);
    expect(recent[0]).toMatchObject({
      symbol: "SYM5",
      name: "Security 5 updated",
    });
    expect(recent.some((item) => item.symbol === "SYM0")).toBe(false);

    const persisted = JSON.parse(localStorage.getItem("ui-settings") || "{}") as {
      state?: { recentSecurities?: Array<{ symbol: string }> };
    };
    expect(persisted.state?.recentSecurities).toHaveLength(20);
    expect(persisted.state?.recentSecurities?.[0]?.symbol).toBe("SYM5");
  });
});
