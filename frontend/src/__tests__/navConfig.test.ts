import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { NAV_SECTIONS, PINNED_DEFAULT, findNavItem, type NavSection } from "../components/layout/navConfig";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readAppRoutes() {
  const appPath = join(__dirname, "../App.tsx");
  const content = readFileSync(appPath, "utf-8");
  return content;
}

function getAllRoutePaths(appContent: string): string[] {
  const lines = appContent.split("\n");
  const selfClosePaths: string[] = [];
  const parentPaths: string[] = [];

  // Collect all route entries with line info for parent tracking
  interface RouteEntry {
    lineIndex: number;
    path: string;
    isSelfClosing: boolean;
  }

  const entries: RouteEntry[] = [];

  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trim();

    const hasRoute = /^<Route\b/.test(trimmed);
    if (!hasRoute) continue;

    const isSelfClosing = /\/>\s*>/.test(trimmed) || trimmed.endsWith("/>");
    const isIndexOpen = /<Route\s+index\s+/.test(trimmed) && !trimmed.endsWith("/>") && trimmed.endsWith(">");

    if (isIndexOpen) continue;

    const pathMatch = trimmed.match(/path="([^"]*)"/);
    if (!pathMatch) continue;

    const path = pathMatch[1];
    entries.push({ lineIndex, path, isSelfClosing });

    if (isSelfClosing) {
      selfClosePaths.push(path);
    } else {
      parentPaths.push(path);
    }
  }

  // Build the full set of route paths by combining children with their parent scopes.
  // Use a stack-based approach: as we walk through entries in line order,
  // maintain a stack of active parent paths.
  const result: string[] = [];
  const parentStack: string[] = [];

  for (const entry of entries) {
    // Always add the route itself (even opening blocks are valid routes in React Router)
    let fullPath: string;
    if (entry.path.startsWith("/")) {
      fullPath = entry.path;
    } else if (parentStack.length > 0) {
      const currentParent = parentStack[parentStack.length - 1];
      fullPath = currentParent === "/" ? "/" + entry.path : currentParent + "/" + entry.path;
    } else {
      fullPath = entry.path;
    }
    result.push(fullPath);

    if (!entry.isSelfClosing) {
      parentStack.push(entry.path);
    }
  }

  return result;
}

function stripParams(path: string): string {
  return path.replace(/:([^/]+)/g, "").replace(/\/{2,}/g, "/");
}

describe("navConfig", () => {
  const appContent = readAppRoutes();
  const routePaths = getAllRoutePaths(appContent);

  describe("NAV_SECTIONS structure", () => {
    it("has sections in the Contract-9 order", () => {
      const expectedOrder = [
        "markets",
        "research",
        "charts",
        "derivatives",
        "portfolio",
        "quant",
        "risk_ops",
        "system",
      ];
      const actualOrder = NAV_SECTIONS.map((s) => s.id);
      expect(actualOrder).toEqual(expectedOrder);
    });

    it("has unique item ids within each section", () => {
      for (const section of NAV_SECTIONS) {
        const ids = section.items.map((item) => item.id);
        const unique = new Set(ids);
        expect(unique.size).toBe(ids.length);
      }
    });

    it("has unique item ids across all sections", () => {
      const allIds = NAV_SECTIONS.flatMap((s) => s.items.map((item) => item.id));
      const unique = new Set(allIds);
      expect(unique.size).toBe(allIds.length);
    });
  });

  describe("every to resolves to an App.tsx route", () => {
    it.each(NAV_SECTIONS.flatMap((section) =>
      section.items.map((item) => ({ section: section.label, item: item.label, to: item.to })),
    ))("$section / $item ($to) exists in App.tsx", ({ to }) => {
      const stripped = stripParams(to);
      const found = routePaths.some((rp) => {
        const rpStripped = stripParams(rp);
        return rpStripped === stripped || rpStripped.startsWith(stripped + "/");
      });
      expect(found).toBe(true);
    });
  });

  describe("findNavItem", () => {
    it("resolves exact match /home", () => {
      const result = findNavItem("/home");
      expect(result).not.toBeNull();
      expect(result?.item.id).toBe("home");
      expect(result?.section.id).toBe("markets");
    });

    it("resolves /equity/security/RELIANCE to security-hub", () => {
      const result = findNavItem("/equity/security/RELIANCE");
      expect(result).not.toBeNull();
      expect(result?.item.id).toBe("security-hub");
      expect(result?.section.id).toBe("research");
    });

    it("resolves /equity/security (exact) to security-hub", () => {
      const result = findNavItem("/equity/security");
      expect(result).not.toBeNull();
      expect(result?.item.id).toBe("security-hub");
    });

    it("resolves /fno to option-chain", () => {
      const result = findNavItem("/fno");
      expect(result).not.toBeNull();
      expect(result?.item.id).toBe("option-chain");
    });

    it("resolves /backtesting to backtesting", () => {
      const result = findNavItem("/backtesting");
      expect(result).not.toBeNull();
      expect(result?.item.id).toBe("backtesting");
    });

    it("resolves /equity/chart-workstation to workstation", () => {
      const result = findNavItem("/equity/chart-workstation");
      expect(result).not.toBeNull();
      expect(result?.item.id).toBe("workstation");
    });

    it("returns null for unknown path", () => {
      const result = findNavItem("/nope");
      expect(result).toBeNull();
    });

    it("returns null for completely unknown path", () => {
      const result = findNavItem("/unknown/path");
      expect(result).toBeNull();
    });
  });

  describe("PINNED_DEFAULT", () => {
    it("has 9 items", () => {
      expect(PINNED_DEFAULT).toHaveLength(9);
    });

    it("all pinned ids exist in NAV_SECTIONS", () => {
      const allIds = new Set(NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.id)));
      for (const id of PINNED_DEFAULT) {
        expect(allIds.has(id)).toBe(true);
      }
    });

    it("contains expected ids", () => {
      const expected = [
        "home",
        "market",
        "security-hub",
        "screener",
        "workstation",
        "portfolio",
        "watchlist",
        "alerts",
        "settings",
      ];
      expect(PINNED_DEFAULT).toEqual(expected);
    });
  });

  describe("item labels and glyphs", () => {
    it("every item has non-empty id, label, to, glyph", () => {
      for (const section of NAV_SECTIONS) {
        for (const item of section.items) {
          expect(item.id).toBeTruthy();
          expect(item.label).toBeTruthy();
          expect(item.to).toBeTruthy();
          expect(item.glyph).toBeTruthy();
        }
      }
    });
  });

  describe("section labels", () => {
    it("every section has non-empty id and label", () => {
      for (const section of NAV_SECTIONS) {
        expect(section.id).toBeTruthy();
        expect(section.label).toBeTruthy();
        expect(section.items.length).toBeGreaterThan(0);
      }
    });
  });
});