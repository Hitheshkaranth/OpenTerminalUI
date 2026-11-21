import { describe, expect, it } from "vitest";
import { formatCompactMoney, formatMoney } from "../utils/formatters";

describe("formatMoney", () => {
  it("uses the holding's own currency symbol", () => {
    expect(formatMoney(4110.72, "USD")).toBe("$4,110.72");
    expect(formatMoney(228, "usd")).toBe("$228.00");
    expect(formatMoney(1234.5, "GBP")).toBe("£1,234.50");
  });
  it("keeps the lakh/crore style for INR", () => {
    expect(formatMoney(27550, "INR")).toBe("₹ 27,550");
    expect(formatMoney(250000, "INR")).toBe("₹ 2.5 L");
  });
  it("never invents a currency when it is unknown", () => {
    expect(formatMoney(19906.18, null)).toBe("19,906.18");
    expect(formatMoney(undefined, "USD")).toBe("-");
  });
  it("formats compact axis labels per currency", () => {
    expect(formatCompactMoney(4100, "USD")).toBe("$4.1K");
    expect(formatCompactMoney(275000, "INR")).toBe("INR 2.75L");
  });
});
