import { describe, expect, it } from "vitest";
import { dossierMarket } from "../api/researchDossiers";

describe("dossier market from agent screen context", () => {
  it.each([
    ["NASDAQ", "US"], ["NYSE", "US"], ["NSE", "IN"], ["BSE", "IN"],
    ["US", "US"], ["IN", "IN"], [" nse ", "IN"], [undefined, "US"],
  ])("maps %s to supported country %s", (contextMarket, expected) => {
    expect(dossierMarket(contextMarket)).toBe(expected);
  });
});
