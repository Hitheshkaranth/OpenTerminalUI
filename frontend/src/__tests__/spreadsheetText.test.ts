import { describe, expect, it } from "vitest";
import { spreadsheetClipboardCell } from "../utils/spreadsheetText";

describe("clipboard spreadsheet literals", () => {
  it.each(["=1+1", "+SUM(1)", "-cmd", "@formula", " \t=1"])("neutralizes formula text %s", (text) => {
    expect(spreadsheetClipboardCell(text).startsWith("'")).toBe(true);
  });
  it("preserves numeric values and prevents extra pasted cells", () => {
    expect(spreadsheetClipboardCell(-12.5)).toBe("-12.5");
    expect(spreadsheetClipboardCell("AAPL\t=1\nMSFT")).toBe("AAPL =1 MSFT");
    expect(spreadsheetClipboardCell(null)).toBe("");
  });
});
