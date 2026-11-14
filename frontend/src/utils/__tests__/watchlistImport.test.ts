import { describe, expect, it } from "vitest";
import { MAX_WATCHLIST_IMPORT_BYTES, parseWatchlistImport } from "../watchlistImport";

describe("watchlist import review", () => {
  it("normalizes case and distinguishes duplicates, existing, and invalid rows", () => {
    const result = parseWatchlistImport("aapl\nMSFT\nmsft\nAAPL MSFT\nNASDAQ:NVDA\n", ["AAPL"]);
    expect(result.error).toBeNull();
    expect(result.symbols).toEqual(["MSFT", "NASDAQ:NVDA"]);
    expect(result.rows.map((row) => row.status)).toEqual(["existing", "ready", "duplicate", "invalid", "ready"]);
  });
  it("reads export CSV with reordered columns, quotes, BOM, and CRLF", () => {
    const result = parseWatchlistImport('\uFEFFname,price,ticker\r\n"Apple, Inc.",250,aapl\r\n"Escaped ""name""",200,msft\r\n');
    expect(result.symbols).toEqual(["AAPL", "MSFT"]);
    expect(result.rows.map((row) => row.line)).toEqual([2, 3]);
  });
  it("supports tab and semicolon CSV, including leading blank rows", () => {
    expect(parseWatchlistImport("\n\nsymbol;name\nAAPL;Apple").symbols).toEqual(["AAPL"]);
    expect(parseWatchlistImport("ticker\tname\nMSFT\tMicrosoft").symbols).toEqual(["MSFT"]);
  });
  it("imports TradingView comma-separated exchange-qualified TXT without guessing an exchange", () => {
    const result = parseWatchlistImport("NASDAQ:AAPL,NASDAQ:MSFT,NSE:RELIANCE,nasdaq:msft", ["NASDAQ:AAPL"]);
    expect(result.error).toBeNull();
    expect(result.symbols).toEqual(["NASDAQ:MSFT", "NSE:RELIANCE"]);
    expect(result.rows.map((row) => row.status)).toEqual(["existing", "ready", "ready", "duplicate"]);
    expect(parseWatchlistImport("NASDAQ:AAPL,MSFT").error).toMatch(/explicit exchange prefix/);
  });
  it("shows TradingView section markers as skipped invalid rows rather than symbols", () => {
    const result = parseWatchlistImport("###US TECH,NASDAQ:AAPL,###INDIA,NSE:RELIANCE");
    expect(result.symbols).toEqual(["NASDAQ:AAPL", "NSE:RELIANCE"]);
    expect(result.rows.map((row) => row.status)).toEqual(["invalid", "ready", "invalid", "ready"]);
    expect(result.rows[0].reason).toMatch(/Section label/);
  });
  it("preserves explicit exchange qualification without assigning one to bare symbols", () => {
    expect(parseWatchlistImport("AAPL\nRELIANCE.NS\nNASDAQ:MSFT\nGC=F\n^NSEI\nM&M.NS\nBTC-USD").symbols)
      .toEqual(["AAPL", "RELIANCE.NS", "NASDAQ:MSFT", "GC=F", "^NSEI", "M&M.NS", "BTC-USD"]);
  });
  it("only applies an exchange when the file explicitly supplies it", () => {
    const result = parseWatchlistImport("symbol,exchange\nAAPL,NASDAQ\nNASDAQ:MSFT,NASDAQ\nRELIANCE.NS,NSE\nAAPL,UNKNOWN\nBSE:TCS,NSE\nTCS.NS,BSE");
    expect(result.symbols).toEqual(["NASDAQ:AAPL", "NASDAQ:MSFT", "RELIANCE.NS"]);
    expect(result.rows.slice(3).every((row) => row.status === "invalid")).toBe(true);
  });
  it("rejects ambiguous multi-column input and duplicate symbol columns", () => {
    expect(parseWatchlistImport("AAPL,MSFT\nNVDA,GOOGL").error).toMatch(/include a symbol or ticker header/);
    expect(parseWatchlistImport("symbol,ticker\nAAPL,MSFT").error).toMatch(/exactly one/);
  });
  it.each(['symbol\n"AAPL', 'symbol\n"AAPL"junk', 'symbol\nAA"PL'])('rejects malformed quoted CSV: %s', (text) => {
    expect(parseWatchlistImport(text).error).toBeTruthy();
    expect(parseWatchlistImport(text).symbols).toEqual([]);
  });
  it("does not accept formula-like or overlong symbols", () => {
    const result = parseWatchlistImport(`=SUM(A1)\n+MSFT\n${"A".repeat(41)}\n^\nAAPL?x=1\n<script>\nAAPL::MSFT\nNASDAQ:\nA^APL`);
    expect(result.symbols).toEqual([]);
    expect(result.rows.every((row) => row.status === "invalid")).toBe(true);
  });
  it("enforces bounded byte and row sizes", () => {
    expect(parseWatchlistImport("A".repeat(MAX_WATCHLIST_IMPORT_BYTES + 1)).error).toMatch(/64 KiB/);
    expect(parseWatchlistImport("界".repeat(MAX_WATCHLIST_IMPORT_BYTES / 2)).error).toMatch(/64 KiB/);
    expect(parseWatchlistImport(Array.from({ length: 501 }, (_, index) => `S${index}`).join("\n")).error).toMatch(/500/);
    expect(parseWatchlistImport(Array.from({ length: 501 }, (_, index) => `NASDAQ:S${index}`).join(",")).error).toMatch(/500/);
    expect(parseWatchlistImport(Array.from({ length: 500 }, (_, index) => `S${index}`).join("\n")).symbols).toHaveLength(500);
  });
  it("reviews missing symbols as invalid while ignoring empty rows", () => {
    const result = parseWatchlistImport("symbol,name\n,Missing\n\nMSFT,Microsoft\n");
    expect(result.rows.map((row) => row.status)).toEqual(["invalid", "ready"]);
    expect(result.symbols).toEqual(["MSFT"]);
  });
  it("rejects empty content and header-only files", () => {
    expect(parseWatchlistImport(" \n\r\n").error).toBeTruthy();
    expect(parseWatchlistImport("symbol\n").error).toMatch(/no symbols/);
  });
  it("can parse multiline names without splitting a CSV record", () => {
    const result = parseWatchlistImport('symbol,name\nAAPL,"Apple\nCompany"\nMSFT,Microsoft');
    expect(result.symbols).toEqual(["AAPL", "MSFT"]);
    expect(result.rows.map((row) => row.line)).toEqual([2, 4]);
  });
});
