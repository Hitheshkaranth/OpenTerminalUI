import { describe, expect, it } from "vitest";

import { CommoditiesPage } from "../pages/Commodities";

describe("CommoditiesPage", () => {
  it("exports the commodities terminal page", () => {
    expect(CommoditiesPage).toBeTypeOf("function");
  });
});
