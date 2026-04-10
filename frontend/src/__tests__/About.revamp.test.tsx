import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AboutPage } from "../pages/About";

const navigateSpy = vi.fn();
const writeTextMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => null),
  });
});

beforeEach(() => {
  navigateSpy.mockReset();
  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  vi.stubGlobal("__BUILD_DATE__", "2026-03-11T00:00:00.000Z");
  vi.stubGlobal("__GIT_COMMIT__", "abcdef1234567");
  vi.stubGlobal("__APP_VERSION__", "0.2.0");

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextMock },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(terminalType?: "market" | "fno") {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AboutPage terminalType={terminalType} />
    </MemoryRouter>,
  );
}

describe("AboutPage dossier revamp", () => {
  it("renders repo intelligence, stack and module registry panels, and command surfaces", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "OpenTerminal UI" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "OpenTerminalUI logo" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tech Stack" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Module Registry" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Command Surfaces" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Repository Intelligence" })).toBeInTheDocument();
    expect(screen.getByText("79")).toBeInTheDocument();
    expect(screen.getByText(/Routes Indexed/i)).toBeInTheDocument();
    expect(screen.getByText(/Language Breakdown/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Breakout Scanner/i })).toHaveAttribute("href", "/equity/screener");
    expect(screen.getByRole("link", { name: "Open GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Hitheshkaranth/OpenTerminalUI",
    );
    expect(screen.getByRole("link", { name: "Star on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Hitheshkaranth/OpenTerminalUI/stargazers",
    );
  });

  it("copies the repository url and keeps the explicit back action", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Copy repository URL" }));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith("https://github.com/Hitheshkaranth/OpenTerminalUI"),
    );
    expect(screen.getByText("Copied")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });

  it("preserves escape-key navigation for the F&O variant", () => {
    renderPage("fno");

    expect(screen.getAllByText("Derivatives Desk").length).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });
});
