import { beforeEach, describe, expect, it } from "vitest";

import { NAV_SECTIONS, PINNED_DEFAULT } from "../../components/layout/navConfig";
import { MAX_PINNED_TOOLS, QUICK_ACCESS_STORAGE_KEY, sanitizePinnedTools, useQuickAccessStore } from "../quickAccessStore";

describe("shared quick access pins", () => {
  beforeEach(() => {
    localStorage.clear();
    useQuickAccessStore.setState({ pinnedIds: [] });
  });

  it("uses safe registered IDs and removes duplicates", () => {
    expect(sanitizePinnedTools(["screener", "screener", "javascript:alert(1)", "//example.org", null, "watchlist"])).toEqual(["screener", "watchlist"]);
    expect(sanitizePinnedTools({})).toEqual(PINNED_DEFAULT);
    expect(sanitizePinnedTools([])).toEqual([]);
  });

  it("reads legacy sidebar favorites without changing the storage schema", async () => {
    localStorage.setItem(QUICK_ACCESS_STORAGE_KEY, JSON.stringify(["watchlist", "screener", "unknown"]));
    await useQuickAccessStore.persist.rehydrate();
    expect(useQuickAccessStore.getState().pinnedIds).toEqual(["watchlist", "screener"]);
    useQuickAccessStore.getState().togglePin("alerts");
    expect(JSON.parse(localStorage.getItem(QUICK_ACCESS_STORAGE_KEY)!)).toEqual(["watchlist", "screener", "alerts"]);
  });

  it("keeps unpinning all favorites empty after reload", async () => {
    useQuickAccessStore.getState().togglePin("screener");
    useQuickAccessStore.getState().togglePin("screener");
    await useQuickAccessStore.persist.rehydrate();
    expect(useQuickAccessStore.getState().pinnedIds).toEqual([]);
  });

  it("rejects unsafe IDs at mutation time", () => {
    useQuickAccessStore.getState().togglePin("https://example.org");
    useQuickAccessStore.getState().togglePin("__proto__");
    expect(useQuickAccessStore.getState().pinnedIds).toEqual([]);
  });

  it("bounds imported pins and permits removal when full", () => {
    const ids = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.id));
    expect(sanitizePinnedTools(ids)).toHaveLength(MAX_PINNED_TOOLS);
    for (const id of ids) useQuickAccessStore.getState().togglePin(id);
    expect(useQuickAccessStore.getState().pinnedIds).toHaveLength(MAX_PINNED_TOOLS);
    useQuickAccessStore.getState().togglePin(ids[0]);
    useQuickAccessStore.getState().togglePin(ids[MAX_PINNED_TOOLS]);
    expect(useQuickAccessStore.getState().pinnedIds).toHaveLength(MAX_PINNED_TOOLS);
    expect(useQuickAccessStore.getState().pinnedIds).toContain(ids[MAX_PINNED_TOOLS]);
  });

  it("recovers from corrupt stored JSON without losing store actions", async () => {
    localStorage.setItem(QUICK_ACCESS_STORAGE_KEY, "not JSON");
    await useQuickAccessStore.persist.rehydrate();
    expect(typeof useQuickAccessStore.getState().togglePin).toBe("function");
    expect(useQuickAccessStore.getState().pinnedIds).toEqual(PINNED_DEFAULT);
    useQuickAccessStore.getState().togglePin("ops");
    expect(useQuickAccessStore.getState().pinnedIds).toContain("ops");
  });
});
