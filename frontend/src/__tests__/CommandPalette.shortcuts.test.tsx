/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("surfaces workstation chart commands and dispatches them through the existing palette", () => {
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
    expect(screen.getByText("Toggle Indicators")).toBeTruthy();
    expect(screen.getByText("Toggle Volume Profile")).toBeTruthy();

    const input = screen.getByPlaceholderText("Type function code, alias, or ticker...");
    fireEvent.change(input, { target: { value: "alerts" } });

    // Select the second item (idx 1) which is the CHART command
    fireEvent.keyDown(input, { key: "ArrowDown" });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect((actionSpy.mock.calls[0]?.[0] as CustomEvent<{ id: string }>).detail.id).toBe("chart.openAlerts");

    window.removeEventListener(CHART_WORKSTATION_ACTION_EVENT, actionSpy as EventListener);
  });

  it("keeps the palette open and shows actionable feedback when a chart command fails", () => {
    const actionSpy = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean; ok?: boolean; message?: string }>).detail;
      detail.handled = true;
      detail.ok = false;
      detail.message = "Select a chart pane first.";
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
    fireEvent.change(input, { target: { value: "replay" } });

    // Select the CHART command (Toggle Replay)
    fireEvent.keyDown(input, { key: "ArrowDown" });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Command Palette")).toBeTruthy();
    expect(screen.getByText("Select a chart pane first.")).toBeTruthy();

    window.removeEventListener(CHART_WORKSTATION_ACTION_EVENT, actionSpy as EventListener);
  });
});
