import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DrawingObjectTree } from "../components/chart/DrawingObjectTree";
import { createDrawing } from "../shared/chart/drawingEngine";

describe("DrawingObjectTree", () => {
  it("renders ordered rows and forwards object-tree actions", () => {
    const lower = createDrawing("trendline", [{ time: 10, price: 10 }, { time: 20, price: 20 }], undefined, {
      id: "lower",
      order: 0,
    });
    const upper = createDrawing("rectangle", [{ time: 30, price: 30 }, { time: 40, price: 20 }], undefined, {
      id: "upper",
      order: 1,
    });
    if (!lower || !upper) throw new Error("expected drawings");

    const onSelect = vi.fn();
    const onToggleVisibility = vi.fn();
    const onToggleLocked = vi.fn();
    const onMoveLayer = vi.fn();

    render(
      <DrawingObjectTree
        drawings={[lower, upper]}
        selectedDrawingId="upper"
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
        onToggleLocked={onToggleLocked}
        onMoveLayer={onMoveLayer}
      />,
    );

    const rows = Array.from(screen.getByTestId("drawing-object-tree").children).map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(rows).toEqual(["drawing-object-upper", "drawing-object-lower"]);

    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Rectangle" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock Rectangle" }));
    fireEvent.click(screen.getByRole("button", { name: "Bring Rectangle to front" }));

    expect(onSelect).toHaveBeenCalledWith("upper");
    expect(onToggleVisibility).toHaveBeenCalledWith("upper");
    expect(onToggleLocked).toHaveBeenCalledWith("upper");
    expect(onMoveLayer).toHaveBeenCalledWith("upper", "front");
  });
});
