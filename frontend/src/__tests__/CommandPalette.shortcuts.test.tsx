/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

import { CHART_WORKSTATION_ACTION_EVENT } from "../components/layout/commanding";
import { CommandPalette } from "../components/layout/CommandPalette";

const navigateSpy = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

// Mock API client
vi.mock("../api/client", () => ({
  searchSymbols: vi.fn().mockResolvedValue([]),
  fetchCryptoSearch: vi.fn().mockResolvedValue([]),
}));

describe("CommandPalette keyboard shortcuts", () => {
  beforeEach(() => {
    navigateSpy.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("respects editable focus and opens shortcut help", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <input aria-label="external-input" />
        <CommandPalette />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText("external-input");
    input.focus();
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    expect(screen.queryByText("Command Palette")).toBeFalsy();

    input.blur();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByText("Command Palette")).toBeTruthy();

    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    expect(screen.getByText("Shortcut Help")).toBeTruthy();
  });

  it("surfaces workstation chart commands and dispatches them through the existing palette", async () => {
    const actionSpy = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean; ok?: boolean }>).detail;
      detail.handled = true;
      detail.ok = true;
    });
    window.addEventListener(CHART_WORKSTATION_ACTION_EVENT, actionSpy as EventListener);

    render(
      <MemoryRouter
        initialEntries={["/equity/chart-workstation"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByText("Toggle Indicators")).toBeInTheDocument();
    expect(screen.getByText("Toggle Volume Profile")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Type function code, alias, or ticker...");
    fireEvent.change(input, { target: { value: "Open Alert Center" } });

    const button = await screen.findByRole("button", { name: /Open Alert Center/i });
    fireEvent.click(button);

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect((actionSpy.mock.calls[0]?.[0] as CustomEvent<{ id: string }>).detail.id).toBe("chart.openAlerts");

    window.removeEventListener(CHART_WORKSTATION_ACTION_EVENT, actionSpy as EventListener);
  });

  it("keeps the palette open and shows actionable feedback when a chart command fails", async () => {
    const errorMsg = "Replay controls requires an active chart pane. Click a pane or use 1-9 first.";
    const actionSpy = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean; ok?: boolean; message?: string }>).detail;
      detail.handled = true;
      detail.ok = false;
      detail.message = errorMsg;
    });
    window.addEventListener(CHART_WORKSTATION_ACTION_EVENT, actionSpy as EventListener);

    render(
      <MemoryRouter
        initialEntries={["/equity/chart-workstation"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText("Type function code, alias, or ticker...");
    fireEvent.change(input, { target: { value: "Toggle Replay" } });

    const button = await screen.findByRole("button", { name: /Toggle Replay/i });
    fireEvent.click(button);

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Command Palette")).toBeInTheDocument();
    expect(screen.getByText(errorMsg)).toBeInTheDocument();

    window.removeEventListener(CHART_WORKSTATION_ACTION_EVENT, actionSpy as EventListener);
  });
});
