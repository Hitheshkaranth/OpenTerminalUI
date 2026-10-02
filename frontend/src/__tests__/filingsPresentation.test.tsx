import { describe, expect, it } from "vitest";

import {
  docSourceLabel,
  formatDate,
  formatCitationLabel,
  formatDriverValue,
  formatKeyNumber,
  formatPeriod,
  statusLabel,
  statusVariant,
  toneLabel,
  toneVariant,
  stanceLabel,
  stanceVariant,
  strengthPct,
} from "../components/filings/presentation";

describe("presentation helpers", () => {
  it("maps stance to a label and a success/neutral/danger variant", () => {
    expect(stanceLabel("constructive")).toBe("Constructive");
    expect(stanceLabel("cautious")).toBe("Cautious");
    expect(stanceLabel("balanced")).toBe("Balanced");
    expect(stanceLabel(undefined)).toBe("Balanced");

    expect(stanceVariant("constructive")).toBe("success");
    expect(stanceVariant("cautious")).toBe("danger");
    expect(stanceVariant("balanced")).toBe("neutral");
    expect(stanceVariant(undefined)).toBe("neutral");
  });

  it("maps guidance status to pos / neg / neutral", () => {
    expect(statusLabel("raised")).toBe("Raised");
    expect(statusVariant("raised")).toBe("success");
    expect(statusVariant("met")).toBe("success");
    expect(statusVariant("missed")).toBe("danger");
    expect(statusVariant("lowered")).toBe("danger");
    expect(statusVariant("new")).toBe("neutral");
    expect(statusVariant("reiterated")).toBe("neutral");
    expect(statusVariant("unknown")).toBe("neutral");
    expect(statusVariant(undefined)).toBe("neutral");
  });

  it("maps management tone", () => {
    expect(toneLabel("positive")).toBe("Positive");
    expect(toneVariant("positive")).toBe("success");
    expect(toneVariant("negative")).toBe("danger");
    expect(toneVariant("neutral")).toBe("neutral");
    expect(toneVariant(undefined)).toBe("neutral");
  });

  it("shows a dash for missing scalars", () => {
    expect(formatPeriod(null)).toBe("—");
    expect(formatDate(null)).toBe("—");
    expect(docSourceLabel(null)).toBe("—");
    expect(formatDriverValue({ magnitude: "low", confidence: 0, claim: "", metric: "x", unit: null, period: null, value: null, citation: {} as never })).toBe("—");
    expect(formatKeyNumber("Revenue", null, "Cr")).toBe("—");
  });

  it("builds a citation label", () => {
    expect(
      formatCitationLabel({ title: "Annual Report 2025", page_start: 12, page_end: 12, section: "MD&A", quote: "x", doc_id: 1, source_url: null }),
    ).toBe("Annual Report 2025 · p.12 · MD&A");
    expect(formatCitationLabel(null)).toBe("—");
  });

  it("formats key numbers with unit", () => {
    expect(formatKeyNumber("Revenue", 1500.5, "Cr")).toBe("1,500.5 Cr");
  });

  it("clamps strength to 0..100", () => {
    expect(strengthPct(78)).toBe(78);
    expect(strengthPct(-5)).toBe(0);
    expect(strengthPct(150)).toBe(100);
    expect(strengthPct(null)).toBe(0);
  });
});