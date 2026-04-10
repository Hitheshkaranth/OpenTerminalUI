/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import {
  calculateAtrShares,
  calculateFixedFractionalShares,
  calculateKellyPercentage,
  calculatePositionSizing,
  calculateVolatilityTargetShares,
} from "../PositionSizerPage";

describe("PositionSizerPage calculations", () => {
  it("computes fixed fractional shares", () => {
    expect(calculateFixedFractionalShares(1_000_000, 1, 2_500, 2_450)).toBe(200);
  });

  it("computes Kelly criterion percentage", () => {
    expect(calculateKellyPercentage(60, 100, 50)).toBeCloseTo(0.4, 6);
  });

  it("computes ATR-based sizing", () => {
    expect(calculateAtrShares(1_000_000, 1, 2, 25)).toBe(200);
  });

  it("computes volatility target sizing", () => {
    expect(calculateVolatilityTargetShares(1_000_000, 15, 30, 2_500)).toBeCloseTo(200, 6);
  });

  it("flags stop equals entry", () => {
    const result = calculatePositionSizing({
      accountSize: 1_000_000,
      riskMode: "percent",
      riskValue: 1,
      entryPrice: 2_500,
      stopLossPrice: 2_500,
      targetPrice: null,
      atrValue: null,
      method: "fixed_fractional",
      winRatePct: 55,
      avgWin: 100,
      avgLoss: 50,
      atrMultiplier: 2,
      targetVolPct: 15,
      stockAnnualVolPct: 25,
    });

    expect(result.errors).toContain("Stop loss must differ from entry.");
    expect(result.shares).toBe(0);
  });

  it("flags negative values", () => {
    const result = calculatePositionSizing({
      accountSize: -1_000_000,
      riskMode: "percent",
      riskValue: 1,
      entryPrice: 2_500,
      stopLossPrice: 2_450,
      targetPrice: null,
      atrValue: null,
      method: "fixed_fractional",
      winRatePct: 55,
      avgWin: 100,
      avgLoss: 50,
      atrMultiplier: 2,
      targetVolPct: 15,
      stockAnnualVolPct: 25,
    });

    expect(result.errors).toContain("Account size cannot be negative.");
  });
});
