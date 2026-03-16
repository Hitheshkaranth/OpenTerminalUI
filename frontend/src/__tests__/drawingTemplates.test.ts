import { describe, expect, it } from "vitest";

import { createDrawing } from "../shared/chart/drawingEngine";
import {
  applyDrawingTemplate,
  createDrawingTemplateFromDrawing,
  normalizeStoredDrawingTemplates,
  resolvePreferredTemplate,
  toggleDrawingTemplateFavorite,
  upsertDrawingTemplate,
} from "../shared/chart/drawingTemplates";

describe("drawingTemplates", () => {
  it("normalizes stored templates and sorts favorites first", () => {
    const templates = normalizeStoredDrawingTemplates([
      {
        id: "old",
        name: "Old",
        toolType: "trendline",
        family: "line",
        style: { color: "#ff0", lineWidth: 2, lineStyle: "solid", fillColor: null, fillOpacity: 0 },
        favorite: false,
        createdAt: "2026-03-12T00:00:00Z",
      },
      {
        id: "fav",
        name: "Fav",
        toolType: "ray",
        family: "line",
        style: { color: "#0ff", lineWidth: 3, lineStyle: "dashed", fillColor: null, fillOpacity: 0 },
        favorite: true,
        createdAt: "2026-03-13T00:00:00Z",
      },
    ]);

    expect(templates.map((template) => template.id)).toEqual(["fav", "old"]);
  });

  it("creates, favorites, and resolves preferred templates across tool families", () => {
    const drawing = createDrawing("rectangle", [{ time: 10, price: 10 }, { time: 20, price: 20 }], undefined, {
      id: "box",
      style: { color: "#55aa55", fillColor: "#55aa55", fillOpacity: 28 },
    });
    if (!drawing) throw new Error("expected drawing");

    const created = createDrawingTemplateFromDrawing(drawing, "Range Template");
    const saved = upsertDrawingTemplate([], created);
    const favorited = toggleDrawingTemplateFavorite(saved, created.id);
    const preferred = resolvePreferredTemplate(favorited, "rectangle", "range");

    expect(preferred?.name).toBe("Range Template");
    expect(preferred?.favorite).toBe(true);
    expect(preferred?.style.fillOpacity).toBe(28);
  });

  it("applies template styles back onto a drawing", () => {
    const drawing = createDrawing("ray", [{ time: 10, price: 10 }, { time: 20, price: 20 }], undefined, { id: "ray-1" });
    if (!drawing) throw new Error("expected drawing");

    const template = {
      ...createDrawingTemplateFromDrawing(drawing, "Ray Style"),
      style: {
        color: "#ef8354",
        lineWidth: 4 as const,
        lineStyle: "dashed" as const,
        fillColor: null,
        fillOpacity: 0,
      },
    };

    const updated = applyDrawingTemplate(drawing, template);
    expect(updated.style).toEqual(template.style);
  });
});
