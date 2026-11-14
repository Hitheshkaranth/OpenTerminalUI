import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IconRail } from "../components/layout/IconRail";
import { PINNED_DEFAULT } from "../components/layout/navConfig";
import { useNavigationStore } from "../store/navigationStore";
import { useQuickAccessStore } from "../store/quickAccessStore";

const navigateSpy = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useLocation: () => ({ pathname: "/home", search: "", hash: "", state: null, key: "default" }),
  };
});

describe("IconRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useQuickAccessStore.setState({ pinnedIds: [...PINNED_DEFAULT] });
    useNavigationStore.setState({
      history: [
        { path: "/equity/screener", label: "Screener", breadcrumbs: ["Markets", "Screener"], timestamp: 1 },
        { path: "/equity/factors", label: "Factors", breadcrumbs: ["Research", "Factors"], timestamp: 2 },
        { path: "/equity/chart-workstation", label: "Workstation", breadcrumbs: ["Charts", "Workstation"], timestamp: 3 },
      ],
      currentIndex: 2,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  function renderIconRail() {
    return render(
      <MemoryRouter initialEntries={["/home"]}>
        <IconRail />
      </MemoryRouter>,
    );
  }

  async function expandRail() {
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    await screen.findByRole("button", { name: "Collapse navigation" });
  }

  describe("collapsed mode (default)", () => {
    it("shows the brand icon", () => {
      renderIconRail();
      expect(screen.getByAltText("OpenTerminalUI")).toBeInTheDocument();
    });

    it("shows the core pinned links", () => {
      renderIconRail();
      for (const label of ["Home", "Market", "Security Hub", "Screener", "Workstation", "Portfolio", "Watchlist", "Alerts", "Settings"]) {
        expect(screen.getByRole("link", { name: label, exact: true })).toBeInTheDocument();
      }
    });

    it("shows a More button to expand", () => {
      renderIconRail();
      expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
    });

    it("clicking More expands the rail", async () => {
      renderIconRail();
      await expandRail();
      expect(screen.queryByRole("button", { name: "Expand navigation" })).not.toBeInTheDocument();
    });
  });

  describe("expanded mode", () => {
    it("shows section headers", async () => {
      renderIconRail();
      await expandRail();
      for (const name of ["Markets", "Research", "Charts"]) {
        expect(screen.getByRole("button", { name, exact: true })).toBeInTheDocument();
      }
    });

    it("clicking a section header toggles its items", async () => {
      renderIconRail();
      await expandRail();
      expect(screen.getByRole("link", { name: "Economics", exact: true })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Markets", exact: true }));
      expect(screen.queryByRole("link", { name: "Economics", exact: true })).not.toBeInTheDocument();
      // Closing the section must not remove its separately pinned Home link.
      expect(screen.getByRole("link", { name: "Home", exact: true })).toBeInTheDocument();
    });

    it("toggling the header again shows items", async () => {
      renderIconRail();
      await expandRail();
      const markets = screen.getByRole("button", { name: "Markets", exact: true });
      fireEvent.click(markets);
      expect(screen.queryByRole("link", { name: "Economics", exact: true })).not.toBeInTheDocument();
      fireEvent.click(markets);
      expect(await screen.findByRole("link", { name: "Economics", exact: true })).toBeInTheDocument();
    });

    it("expanded state persists to localStorage", async () => {
      renderIconRail();
      await expandRail();
      expect(window.localStorage.getItem("ot:nav:expanded")).toBe("true");
    });

    it("can collapse the expanded rail", async () => {
      renderIconRail();
      await expandRail();
      fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
      expect(await screen.findByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Markets", exact: true })).not.toBeInTheDocument();
    });

    it("shows Recent items", async () => {
      renderIconRail();
      await expandRail();
      const recent = within(screen.getByText("Recent").parentElement!);
      for (const name of ["Screener", "Factors", "Workstation"]) {
        expect(recent.getByRole("link", { name, exact: true })).toBeInTheDocument();
      }
    });

    it("shows Pinned section", async () => {
      renderIconRail();
      await expandRail();
      const pinned = within(screen.getByText("Pinned").parentElement!);
      expect(pinned.getByRole("link", { name: "Home", exact: true })).toBeInTheDocument();
    });

    it("Cmd button dispatches keyboard event", async () => {
      renderIconRail();
      await expandRail();
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      fireEvent.click(screen.getByRole("button", { name: "Cmd", exact: true }));
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "keydown", key: "k", ctrlKey: true }));
    });

    it("account button navigates to /account", async () => {
      renderIconRail();
      await expandRail();
      fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));
      expect(navigateSpy).toHaveBeenCalledWith("/account");
    });
  });
});
