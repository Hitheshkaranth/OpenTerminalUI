/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { CommandPalette } from "../components/layout/CommandPalette";
import { useNavigationHistory } from "../hooks/useNavigationHistory";
import { useNavigationStore, type NavEvent } from "../store/navigationStore";

function NavigationProbe({ autoTrack = false }: { autoTrack?: boolean }) {
  const location = useLocation();
  const { breadcrumbs } = useNavigationHistory({ autoTrack });

  return (
    <div>
      <div data-testid="nav-location">{`${location.pathname}${location.search}`}</div>
      <div data-testid="nav-breadcrumbs">{breadcrumbs.map((crumb) => crumb.label).join(" > ")}</div>
    </div>
  );
}

const HISTORY_FIXTURE: NavEvent[] = [
  {
    path: "/equity/watchlist",
    label: "History Watchlist",
    breadcrumbs: ["Home", "Equity", "Watchlist"],
    timestamp: 1,
  },
  {
    path: "/equity/portfolio?view=tca",
    label: "History Portfolio",
    breadcrumbs: ["Home", "Equity", "Portfolio", "Tca"],
    timestamp: 2,
  },
  {
    path: "/equity/hotlists",
    label: "History Hotlists",
    breadcrumbs: ["Home", "Equity", "Hotlists"],
    timestamp: 3,
  },
];

describe("navigation history", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useNavigationStore.setState({ history: [], currentIndex: -1 });
  });

  it("builds breadcrumbs for security hub subtabs", () => {
    render(
      <MemoryRouter initialEntries={["/equity/security/AAPL?tab=financials&subtab=margins"]}>
        <Routes>
          <Route path="*" element={<NavigationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("nav-breadcrumbs").textContent).toBe("Home > Equity > AAPL > Financials > Margins");
  });

  it("navigates backward with Alt+Left", async () => {
    useNavigationStore.setState({ history: HISTORY_FIXTURE.slice(0, 2), currentIndex: 1 });

    render(
      <MemoryRouter initialEntries={["/equity/portfolio?view=tca"]}>
        <Routes>
          <Route path="*" element={<NavigationProbe autoTrack />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("nav-location").textContent).toBe("/equity/watchlist");
    });
  });

  it("shows recent pages in the command palette", async () => {
    useNavigationStore.setState({ history: HISTORY_FIXTURE, currentIndex: 2 });

    render(
      <MemoryRouter initialEntries={["/equity/hotlists"]}>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await screen.findByPlaceholderText("Type function code, alias, or ticker...");
    expect(screen.getByText("History Hotlists")).toBeTruthy();
    expect(screen.getByText("History Portfolio")).toBeTruthy();
    expect(screen.getByText("History Watchlist")).toBeTruthy();
  });
});
