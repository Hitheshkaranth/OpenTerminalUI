import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkflowHubPage } from "../WorkflowHub";
import { useStockStore } from "../../store/stockStore";

const renderHub = () => render(<MemoryRouter><WorkflowHubPage /></MemoryRouter>);

describe("Workflow Hub", () => {
  beforeEach(() => {
    localStorage.removeItem("ot:workflow-hub:v1");
    useStockStore.setState({ ticker: "AAPL" });
  });

  it("restores pinned workflows and remembers the selected workflow", () => {
    const { unmount } = renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Pin Validate a strategy idea" }));
    fireEvent.click(screen.getByRole("button", { name: /Pinned workflows/ }));
    expect(screen.getByRole("article", { name: "Validate a strategy idea steps" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Quant Validate a strategy idea/ }));
    unmount();
    renderHub();
    expect(screen.getByRole("article", { name: "Validate a strategy idea steps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin Validate a strategy idea" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters workflows and tools with a useful reset for empty searches", () => {
    renderHub();
    fireEvent.change(screen.getByRole("textbox", { name: "Search workflows and tools" }), { target: { value: "nonexistent-query" } });
    expect(screen.getByText("No matching workflows")).toBeInTheDocument();
    expect(screen.getByText("No tools match this search")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Reset filters" })[0]);
    expect(screen.getByRole("article", { name: "Find your first research idea steps" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Macro", exact: true }));
    expect(screen.getByRole("article", { name: "Read the macro backdrop steps" })).toBeInTheDocument();
  });

  it("validates symbols before updating the shared context and destinations", () => {
    renderHub();
    const input = screen.getByRole("textbox", { name: "Symbol context" });
    fireEvent.change(input, { target: { value: "AAPL MSFT" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply symbol" }));
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(useStockStore.getState().ticker).toBe("AAPL");
    fireEvent.change(input, { target: { value: "msft" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply symbol" }));
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(useStockStore.getState().ticker).toBe("MSFT");
    const workflow = screen.getByRole("article", { name: "Find your first research idea steps" });
    expect(within(workflow).getByRole("link", { name: "Open Security Hub" })).toHaveAttribute("href", "/equity/security?ticker=MSFT");
  });

  it("recovers from invalid saved preferences", () => {
    localStorage.setItem("ot:workflow-hub:v1", JSON.stringify({ selected: "unknown", pinned: [null, "unknown", "first-session", "first-session"] }));
    renderHub();
    expect(screen.getByRole("article", { name: "Find your first research idea steps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin Find your first research idea" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("ot:workflow-hub:v1")!)).toEqual({ selected: "first-session", pinned: ["first-session"] });
  });
});
