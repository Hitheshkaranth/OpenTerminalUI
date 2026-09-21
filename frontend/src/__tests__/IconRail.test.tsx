import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IconRail } from "../components/layout/IconRail";

const navigateSpy = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useLocation: () => ({ pathname: "/home", search: "", hash: "", state: null, key: "default" }),
  };
});

import { useNavigationStore } from "../store/navigationStore";

describe("IconRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateSpy.mockClear();
    window.localStorage.clear();
    useNavigationStore.setState({
      history: [
        { path: "/equity/screener", label: "Screener", breadcrumbs: ["Markets", "Screener"], timestamp: 1 },
        { path: "/equity/factors", label: "Factors", breadcrumbs: ["Research", "Factors"], timestamp: 2 },
        { path: "/equity/chart-workstation", label: "Workstation", breadcrumbs: ["Charts", "Workstation"], timestamp: 3 },
      ],
      currentIndex: 2,
    });
  });

  function renderIconRail() {
    return render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/home"]}>
        <IconRail />
      </MemoryRouter>,
    );
  }

  describe("collapsed mode (default)", () => {
    it("shows the brand icon", () => {
      renderIconRail();
      expect(screen.getByAltText("OpenTerminalUI")).toBeTruthy();
    });

    it("shows the 9 pinned labels", () => {
      renderIconRail();
      const pinnedLabels = [
        "Home",
        "Market",
        "Security Hub",
        "Screener",
        "Workstation",
        "Portfolio",
        "Watchlist",
        "Alerts",
        "Settings",
      ];
      for (const label of pinnedLabels) {
        expect(screen.getByLabelText(label)).toBeTruthy();
      }
    });

    it("shows a More button to expand", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      expect(moreBtn).toBeTruthy();
    });

    it("clicking More expands the rail", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      fireEvent.click(moreBtn);

      waitFor(() => {
        expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeTruthy();
      });
    });
  });

  describe("expanded mode", () => {
    it("shows section headers", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      fireEvent.click(moreBtn);

      waitFor(() => {
        expect(screen.getByText("Markets")).toBeTruthy();
        expect(screen.getByText("Research")).toBeTruthy();
        expect(screen.getByText("Charts")).toBeTruthy();
      });
    });

    it("clicking a section header toggles its items", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      fireEvent.click(moreBtn);

      waitFor(() => {
        const marketsHeader = screen.getByText("Markets");
        fireEvent.click(marketsHeader);
        expect(screen.queryByText("Home")).toBeNull();
      });
    });

    it("toggling the header again shows items", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      fireEvent.click(moreBtn);

      waitFor(() => {
        const marketsHeader = screen.getByText("Markets");
        fireEvent.click(marketsHeader);
        fireEvent.click(marketsHeader);
        expect(screen.getByLabelText("Home")).toBeTruthy();
      });
    });

    it("expanded state persists to localStorage", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      fireEvent.click(moreBtn);

      expect(window.localStorage.getItem("ot:nav:expanded")).toBe("true");
    });

    it("shows a Collapse button", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      fireEvent.click(moreBtn);

      waitFor(() => {
        const collapseBtn = screen.getByRole("button", { name: "Collapse navigation" });
        expect(collapseBtn).toBeTruthy();
      });
    });

    it("shows Recent items", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      fireEvent.click(moreBtn);

      waitFor(() => {
        expect(screen.getByText("Recent")).toBeTruthy();
        expect(screen.getByText("Screener")).toBeTruthy();
        expect(screen.getByText("Factors")).toBeTruthy();
        expect(screen.getByText("Workstation")).toBeTruthy();
      });
    });

    it("shows Pinned section", () => {
      renderIconRail();
      const moreBtn = screen.getByRole("button", { name: "Expand navigation" });
      fireEvent.click(moreBtn);

      waitFor(() => {
        expect(screen.getByText("Pinned")).toBeTruthy();
        expect(screen.getByLabelText("Home")).toBeTruthy();
      });
    });

    it("Cmd button dispatches keyboard event", () => {
      renderIconRail();
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");

      waitFor(() => {
        const cmdBtn = screen.getByText("Cmd");
        fireEvent.click(cmdBtn);

        expect(dispatchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "keydown",
            key: "k",
          }),
        );
      });
    });

    it("account button navigates to /account", () => {
      renderIconRail();

      waitFor(() => {
        const accountBtn = screen.getByText("trader");
        fireEvent.click(accountBtn);
        expect(navigateSpy).toHaveBeenCalledWith("/account");
      });
    });
  });
});