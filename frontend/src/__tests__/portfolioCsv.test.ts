import { describe, it, expect } from "vitest";
import { parsePortfolioCsv } from "../../src/utils/portfolioCsv";

describe("parsePortfolioCsv", () => {
  describe("zerodha format", () => {
    const csv = [
      "Instrument,Qty.,Avg. cost,LTP,Cur. val,P&L",
      "RELIANCE-EQ,\"1,250.50\",890.25,2456.70,3071527.85,1821277.35",
      "TCS-NSE,150,3120.00,3678.50,551775.00,83775.00",
    ].join("\r\n");

    it("detects zerodha format", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.detectedFormat).toBe("zerodha");
      expect(result.headers).toEqual(["Instrument", "Qty.", "Avg. cost", "LTP", "Cur. val", "P&L"]);
    });

    it("parses rows correctly", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({
        ticker: "RELIANCE",
        quantity: 1250.5,
        avg_buy_price: 890.25,
        buy_date: null,
        exchange: null,
      });
      expect(result.rows[1]).toEqual({
        ticker: "TCS",
        quantity: 150,
        avg_buy_price: 3120,
        buy_date: null,
        exchange: null,
      });
    });

    it("strips -EQ suffix and commas from quantity", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[0].ticker).toBe("RELIANCE");
      expect(result.rows[0].quantity).toBe(1250.5);
    });

    it("no errors", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("groww format", () => {
    const csv = [
      "Stock Name,Quantity,Average buy price,Current price",
      "Infosys,500,1420.50,1650.25",
      "HDFC Bank,200,1580.00,1510.75",
    ].join("\n");

    it("detects groww format", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.detectedFormat).toBe("groww");
    });

    it("keeps single-word names as tickers but rejects multi-word company names", () => {
      const result = parsePortfolioCsv(csv);
      // "Infosys" is a plausible ticker; "HDFC Bank" is a company name, not a symbol.
      expect(result.rows).toEqual([
        { ticker: "INFOSYS", quantity: 500, avg_buy_price: 1420.5, buy_date: null, exchange: null },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].line).toBe(3);
    });
  });

  describe("groww with Symbol column", () => {
    const csv = [
      "Symbol,Stock Name,Quantity,Average buy price",
      "TCS,Tata Consultancy Services,100,3500.00",
    ].join("\n");

    it("uses Symbol column for ticker", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[0].ticker).toBe("TCS");
    });
  });

  describe("generic format", () => {
    const csv = [
      "ticker,quantity,avg_buy_price,buy_date,exchange",
      "AAPL,50,150.00,15-03-2024,NASDAQ",
      "GOOGL,10,2800.50,01/06/2023,NASDAQ",
    ].join("\n");

    it("detects generic format", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.detectedFormat).toBe("generic");
    });

    it("parses rows with DD-MM-YYYY date", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[0]).toEqual({
        ticker: "AAPL",
        quantity: 50,
        avg_buy_price: 150,
        buy_date: "2024-03-15",
        exchange: "NASDAQ",
      });
    });

    it("parses rows with DD/MM/YYYY date", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[1]).toEqual({
        ticker: "GOOGL",
        quantity: 10,
        avg_buy_price: 2800.5,
        buy_date: "2023-06-01",
        exchange: "NASDAQ",
      });
    });
  });

  describe("quoted fields with commas", () => {
    const csv = [
      "ticker,quantity,avg_buy_price",
      '"ACME, Inc.",100,25.50',
      "GOOGL,50,3000.00",
    ].join("\n");

    it("handles quoted fields with commas", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[0].ticker).toBe("ACME INC");
      expect(result.rows[0].quantity).toBe(100);
      expect(result.rows[0].avg_buy_price).toBe(25.5);
    });

    it("handles unquoted fields normally", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[1].ticker).toBe("GOOGL");
    });
  });

  describe("escaped quotes", () => {
    const csv = [
      'ticker,quantity,avg_buy_price',
      '"ABC ""Corp""",200,50.00',
    ].join("\n");

    it('handles "" escapes', () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[0].ticker).toBe("ABC CORP");
      expect(result.rows[0].quantity).toBe(200);
    });
  });

  describe("unknown format", () => {
    const csv = [
      "foo,bar,baz",
      "a,b,c",
    ].join("\n");

    it("detects unknown format", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.detectedFormat).toBe("unknown");
      expect(result.rows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].line).toBe(1);
      expect(result.errors[0].reason).toContain("Unrecognised columns");
      expect(result.errors[0].reason).toContain("foo");
      expect(result.errors[0].reason).toContain("bar");
      expect(result.errors[0].reason).toContain("baz");
    });
  });

  describe("numeric parsing", () => {
    const csv = [
      "ticker,quantity,avg_buy_price",
      "TCS,\"₹1,500.00\",\"₹3,200.50\"",
      "INFY,\"$250.00\",\"$1,500.00\"",
      "GOOGL,100.50, 2800 ",
    ].join("\n");

    it("strips ₹, $, commas and spaces from numbers", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[0].quantity).toBe(1500);
      expect(result.rows[0].avg_buy_price).toBe(3200.5);
      expect(result.rows[1].quantity).toBe(250);
      expect(result.rows[1].avg_buy_price).toBe(1500);
      expect(result.rows[2].quantity).toBe(100.5);
      expect(result.rows[2].avg_buy_price).toBe(2800);
    });
  });

  describe("date parsing", () => {
    const csv = [
      "ticker,quantity,avg_buy_price,buy_date",
      "TCS,100,3000,2024-01-15",
      "INFY,200,1500,25-06-2023",
      "GOOGL,50,2800,31/12/2022",
      "AAPL,30,150,invalid-date",
      "MSFT,40,350,",
    ].join("\n");

    it("parses YYYY-MM-DD as-is", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[0].buy_date).toBe("2024-01-15");
    });

    it("converts DD-MM-YYYY", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[1].buy_date).toBe("2023-06-25");
    });

    it("converts DD/MM/YYYY", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[2].buy_date).toBe("2022-12-31");
    });

    it("sets null for invalid dates", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[3].buy_date).toBeNull();
    });

    it("sets null for empty dates", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows[4].buy_date).toBeNull();
    });
  });

  describe("invalid rows", () => {
    const csv = [
      "ticker,quantity,avg_buy_price",
      "TCS,0,3000",
      "INFY,-5,1500",
      "GOOGL,100,not-a-number",
      ",100,3000",
      "AAPL,100,500",
    ].join("\n");

    it("skips rows with qty <= 0", () => {
      const result = parsePortfolioCsv(csv);
      const validTickers = result.rows.map((r) => r.ticker);
      expect(validTickers).not.toContain("TCS");
      expect(validTickers).not.toContain("INFY");
    });

    it("skips rows with invalid price", () => {
      const result = parsePortfolioCsv(csv);
      const validTickers = result.rows.map((r) => r.ticker);
      expect(validTickers).not.toContain("GOOGL");
    });

    it("skips rows with empty ticker", () => {
      const result = parsePortfolioCsv(csv);
      const validTickers = result.rows.map((r) => r.ticker);
      expect(validTickers).not.toHaveLength(0);
      expect(validTickers).toContain("AAPL");
    });

    it("reports errors with line numbers", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.errors).toHaveLength(4);
      expect(result.errors[0].line).toBe(2);
      expect(result.errors[1].line).toBe(3);
      expect(result.errors[2].line).toBe(4);
      expect(result.errors[3].line).toBe(5);
    });
  });

  describe("CRLF line endings", () => {
    const csv = "ticker,quantity,avg_buy_price\r\nTCS,100,3000\r\nINFY,200,1500\r\n";

    it("handles CRLF", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows).toHaveLength(2);
    });
  });

  describe("blank lines", () => {
    const csv = "\n\nticker,quantity,avg_buy_price\n\nTCS,100,3000\n\nINFY,200,1500\n\n";

    it("skips blank lines", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.rows).toHaveLength(2);
    });
  });

  describe("case-insensitive header matching", () => {
    const csv = [
      "TICKER,QUANTITY,AVG_BUY_PRICE",
      "TCS,100,3000",
    ].join("\n");

    it("matches uppercase headers", () => {
      const result = parsePortfolioCsv(csv);
      expect(result.detectedFormat).toBe("generic");
      expect(result.rows[0].ticker).toBe("TCS");
    });

    const csv2 = [
      "Ticker,Quantity,Avg Buy Price",
      "TCS,100,3000",
    ].join("\n");

    it("matches mixed-case headers", () => {
      const result = parsePortfolioCsv(csv2);
      expect(result.detectedFormat).toBe("generic");
      expect(result.rows[0].ticker).toBe("TCS");
    });
  });

  describe("empty CSV", () => {
    it("returns empty result", () => {
      const result = parsePortfolioCsv("");
      expect(result.rows).toHaveLength(0);
      expect(result.detectedFormat).toBe("unknown");
    });
  });
});
describe("groww without a Symbol column", () => {
  it("rejects company-name tickers instead of importing garbage symbols", () => {
    const csv = `Stock Name,ISIN,Quantity,Average buy price\nReliance Industries,INE002A01018,2,"₹2,400.00"\n`;
    const r = parsePortfolioCsv(csv);
    expect(r.detectedFormat).toBe("groww");
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toMatch(/company name, not a ticker/);
  });
});
