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

describe("CommandPalette deterministic keyboard flow", () => {
  it("opens with Ctrl/Cmd+K and executes selected entry with Enter", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText("Type function code, alias, or ticker...");
    fireEvent.change(input, { target: { value: "WL" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(navigateSpy).toHaveBeenCalledWith("/equity/watchlist");
  });
});
