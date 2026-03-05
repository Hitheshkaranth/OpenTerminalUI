import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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
    expect(screen.queryByText("Command Palette")).not.toBeInTheDocument();

    input.blur();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByText("Command Palette")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    expect(screen.getByText("Shortcut Help")).toBeInTheDocument();
  });
});
