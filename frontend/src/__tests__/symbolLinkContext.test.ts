/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { cycleLinkGroup } from "../contexts/SymbolLinkContext";

describe("SymbolLinkContext", () => {
  it("cycles through all groups and returns to none", () => {
    expect(cycleLinkGroup("none")).toBe("red");
    expect(cycleLinkGroup("red")).toBe("blue");
    expect(cycleLinkGroup("blue")).toBe("green");
    expect(cycleLinkGroup("green")).toBe("yellow");
    expect(cycleLinkGroup("yellow")).toBe("none");
  });
});
