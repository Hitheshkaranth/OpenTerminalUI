import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { QuickAccessBar, recentQuickAccessTools } from "../QuickAccessBar";
import { useQuickAccessStore } from "../../../store/quickAccessStore";
import { useNavigationStore, type NavEvent } from "../../../store/navigationStore";

function event(path: string): NavEvent {
  return { path, label: "Untrusted label", breadcrumbs: [], timestamp: 0 };
}

describe("QuickAccessBar", () => {
  beforeEach(() => {
    useQuickAccessStore.setState({ pinnedIds: [] });
    useNavigationStore.setState({ history: [], currentIndex: -1 });
  });

  it("pins and unpins the current registered tool using the shared sidebar state", () => {
    render(<MemoryRouter initialEntries={["/equity/screener"]}><QuickAccessBar /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Workflows" })).toHaveAttribute("href", "/equity/workflows");
    fireEvent.click(screen.getByRole("button", { name: "Pin Screener" }));
    expect(useQuickAccessStore.getState().pinnedIds).toEqual(["screener"]);
    expect(screen.getByRole("link", { name: "Screener" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Unpin Screener" }));
    expect(useQuickAccessStore.getState().pinnedIds).toEqual([]);
  });

  it("shows deduplicated recent tools without pinned, current, external or unknown paths", () => {
    const recent = recentQuickAccessTools([
      event("/equity/news"), event("/equity/news?ticker=AAPL"), event("/equity/watchlist"),
      event("/equity/screener"), event("https://example.org"), event("//example.org"),
      event("/equity/unknown"), event("/equity/\\evil"),
    ], ["watchlist"], "screener");
    expect(recent.map((item) => item.id)).toEqual(["news"]);
    expect(recent[0].label).toBe("News");
  });

  it("uses the shared pin state when another component changes it", () => {
    useQuickAccessStore.setState({ pinnedIds: ["watchlist"] });
    render(<MemoryRouter initialEntries={["/equity/news"]}><QuickAccessBar /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Watchlist" })).toHaveAttribute("href", "/equity/watchlist");
    expect(screen.queryByRole("link", { name: "Screener" })).toBeNull();
  });
});
