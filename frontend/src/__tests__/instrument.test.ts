import { describe, expect, it } from "vitest";

import {
  parseInstrument,
  formatInstrument,
  countryForExchange,
  isExchange,
  EXCHANGES,
  type Exchange,
  type Instrument,
} from "../lib/instrument";

describe("parseInstrument", () => {
  it('parses "NSE:RELIANCE" -> { symbol: "RELIANCE", exchange: "NSE" }', () => {
    const result = parseInstrument("NSE:RELIANCE");
    expect(result).toEqual({ symbol: "RELIANCE", exchange: "NSE" });
  });

  it('parses "reliance.ns" -> { symbol: "RELIANCE", exchange: "NSE" }', () => {
    const result = parseInstrument("reliance.ns");
    expect(result).toEqual({ symbol: "RELIANCE", exchange: "NSE" });
  });

  it('parses "TCS.BO" -> { symbol: "TCS", exchange: "BSE" }', () => {
    const result = parseInstrument("TCS.BO");
    expect(result).toEqual({ symbol: "TCS", exchange: "BSE" });
  });

  it('parses "AAPL" -> { symbol: "AAPL", exchange: null }', () => {
    const result = parseInstrument("AAPL");
    expect(result).toEqual({ symbol: "AAPL", exchange: null });
  });

  it('parses "nasdaq:aapl" -> { symbol: "AAPL", exchange: "NASDAQ" }', () => {
    const result = parseInstrument("nasdaq:aapl");
    expect(result).toEqual({ symbol: "AAPL", exchange: "NASDAQ" });
  });

  it('parses "NYSE:IBM" -> { symbol: "IBM", exchange: "NYSE" }', () => {
    const result = parseInstrument("NYSE:IBM");
    expect(result).toEqual({ symbol: "IBM", exchange: "NYSE" });
  });

  it('parses "XYZ:ABC" -> { symbol: "XYZ:ABC", exchange: null } (unknown prefix)', () => {
    const result = parseInstrument("XYZ:ABC");
    expect(result).toEqual({ symbol: "XYZ:ABC", exchange: null });
  });

  it("trims whitespace and uppercases", () => {
    const result = parseInstrument("  nse:reliance  ");
    expect(result).toEqual({ symbol: "RELIANCE", exchange: "NSE" });
  });

  it("handles empty string", () => {
    const result = parseInstrument("");
    expect(result).toEqual({ symbol: "", exchange: null });
  });

  it("parses bare symbol with no exchange", () => {
    const result = parseInstrument("INFY");
    expect(result).toEqual({ symbol: "INFY", exchange: null });
  });

  it("parses RELIANCE.NS format", () => {
    const result = parseInstrument("RELIANCE.NS");
    expect(result).toEqual({ symbol: "RELIANCE", exchange: "NSE" });
  });

  it("parses infy.bo format", () => {
    const result = parseInstrument("infy.bo");
    expect(result).toEqual({ symbol: "INFY", exchange: "BSE" });
  });
});

describe("formatInstrument", () => {
  it('formats { symbol: "RELIANCE", exchange: "NSE" } -> "NSE:RELIANCE"', () => {
    const result = formatInstrument({ symbol: "RELIANCE", exchange: "NSE" });
    expect(result).toBe("NSE:RELIANCE");
  });

  it('formats { symbol: "AAPL", exchange: null } -> "AAPL"', () => {
    const result = formatInstrument({ symbol: "AAPL", exchange: null });
    expect(result).toBe("AAPL");
  });

  it("round-trips for NSE", () => {
    const instrument: Instrument = { symbol: "RELIANCE", exchange: "NSE" };
    const formatted = formatInstrument(instrument);
    const parsed = parseInstrument(formatted);
    expect(parsed).toEqual(instrument);
  });

  it("round-trips for BSE", () => {
    const instrument: Instrument = { symbol: "TCS", exchange: "BSE" };
    const formatted = formatInstrument(instrument);
    const parsed = parseInstrument(formatted);
    expect(parsed).toEqual(instrument);
  });

  it("round-trips for NYSE", () => {
    const instrument: Instrument = { symbol: "IBM", exchange: "NYSE" };
    const formatted = formatInstrument(instrument);
    const parsed = parseInstrument(formatted);
    expect(parsed).toEqual(instrument);
  });

  it("round-trips for NASDAQ", () => {
    const instrument: Instrument = { symbol: "AAPL", exchange: "NASDAQ" };
    const formatted = formatInstrument(instrument);
    const parsed = parseInstrument(formatted);
    expect(parsed).toEqual(instrument);
  });

  it("round-trips for bare symbol", () => {
    const instrument: Instrument = { symbol: "MSFT", exchange: null };
    const formatted = formatInstrument(instrument);
    const parsed = parseInstrument(formatted);
    expect(parsed).toEqual(instrument);
  });
});

describe("countryForExchange", () => {
  it("returns IN for NSE", () => {
    expect(countryForExchange("NSE")).toBe("IN");
  });

  it("returns IN for BSE", () => {
    expect(countryForExchange("BSE")).toBe("IN");
  });

  it("returns US for NYSE", () => {
    expect(countryForExchange("NYSE")).toBe("US");
  });

  it("returns US for NASDAQ", () => {
    expect(countryForExchange("NASDAQ")).toBe("US");
  });
});

describe("isExchange", () => {
  it("returns true for valid exchanges", () => {
    expect(isExchange("NSE")).toBe(true);
    expect(isExchange("BSE")).toBe(true);
    expect(isExchange("NYSE")).toBe(true);
    expect(isExchange("NASDAQ")).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isExchange("")).toBe(false);
    expect(isExchange("NSE:")).toBe(false);
    expect(isExchange(null)).toBe(false);
    expect(isExchange(undefined)).toBe(false);
    expect(isExchange(123)).toBe(false);
    expect(isExchange("invalid")).toBe(false);
  });
});

describe("EXCHANGES", () => {
  it("contains exactly the four exchanges", () => {
    expect(EXCHANGES).toEqual(["NSE", "BSE", "NYSE", "NASDAQ"]);
  });
});