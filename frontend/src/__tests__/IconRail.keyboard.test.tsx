import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { IconRail } from "../components/layout/IconRail";

const navigateSpy = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

describe("IconRail keyboard behavior", () => {
  it("moves focus with arrows and navigates with Enter", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/home"]}>
        <IconRail />
      </MemoryRouter>,
    );

    const rail = screen.getByLabelText("Primary icon rail");
    const home = screen.getByLabelText("Home");
    const market = screen.getByLabelText("Market");

    home.focus();
    fireEvent.keyDown(rail, { key: "ArrowDown" });
    expect(document.activeElement).toBe(market);

    fireEvent.keyDown(rail, { key: "Enter" });
    expect(navigateSpy).toHaveBeenCalledWith("/equity/stocks");
  });
});
