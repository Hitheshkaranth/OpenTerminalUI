import { describe, expect, it } from "vitest";

import { placeRrgLabels } from "../components/analysis/SectorRotationMap";

describe("placeRrgLabels", () => {
  it("keeps an isolated label beside its dot", () => {
    const out = placeRrgLabels([{ symbol: "XLK", x: 110, y: 90 }]);
    expect(out.XLK).toMatchObject({ x: 110.8, anchor: "start", leader: false });
  });

  it("never lets placed labels overlap when points are crowded", () => {
    const pts = ["XLY", "XLI", "XLRE", "XLB", "XLP", "XLU"].map((symbol, i) => ({ symbol, x: 95 + (i % 2) * 0.3, y: 104 + i * 0.2 }));
    const out = placeRrgLabels(pts);
    const boxes = Object.entries(out)
      .filter(([, p]) => p)
      .map(([sym, p]) => {
        const w = sym.length * 0.8 * 0.62;
        return { x: p!.anchor === "start" ? p!.x : p!.x - w, y: p!.y - 0.68, w, h: 0.8 };
      });
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    expect(boxes.length).toBeGreaterThan(3);
  });
});
