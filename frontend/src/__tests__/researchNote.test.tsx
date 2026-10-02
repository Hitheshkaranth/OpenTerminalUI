import { describe, expect, it, vi } from "vitest";

import {
  buildResearchNote,
  gatherResearchData,
  toPrintHtml,
  type Analysis,
  type BusinessMetrics,
  type Knowledge,
  type PeerKpiTable,
  type ResearchNoteData,
  type ResultsHistory,
  type ReverseDcf,
  type Stock,
  type ValueChain,
} from "../api/researchNote";

const STOCK: Stock = {
  symbol: "AAPL",
  ticker: "AAPL",
  company_name: "Apple Inc.",
  sector: "Technology",
  current_price: 189.84,
  market_cap: 2_950_000_000_000,
  provenance: { as_of: "2026-10-01T21:00:00Z" },
};

function analysisWithClaim(claim = "Revenue from services jumped sharply."): Analysis {
  return {
    symbol: "AAPL",
    created_at: "2026-10-01T09:00:00Z",
    engine: "llm",
    model: "gpt-research",
    documents_used: 4,
    scores: { growth: 68, headwind: 26, net: 42 },
    stance: "constructive",
    growth: [
      {
        id: "new_products",
        label: "New products & launches",
        kind: "growth",
        summary: "Services revenue accelerated.",
        strength: 74,
        findings: [
          {
            claim,
            metric: "revenue",
            value: 420,
            unit: "M",
            period: "FY25 Q2",
            magnitude: "high",
            confidence: 0.9,
            citation: {
              doc_id: 12,
              title: "Annual Report FY24",
              page_start: 12,
              page_end: 12,
              section: "MD&A",
              quote: "Services revenue jumped sharply.",
              source_url: "https://example.com/annual-report-fy24.pdf",
            },
          },
        ],
      },
    ],
    headwinds: [
      {
        id: "client_concentration",
        label: "Client concentration",
        kind: "headwind",
        summary: "Top two clients are a large share of revenue.",
        strength: 51,
        findings: [
          {
            claim: "Two clients drive 44% of revenue.",
            metric: "revenue_share",
            value: 44,
            unit: "%",
            period: "FY24",
            magnitude: "medium",
            confidence: 0.8,
            citation: {
              doc_id: 13,
              title: "10-Q",
              page_start: 34,
              page_end: 35,
              section: "Risk Factors",
              quote: "Two clients drive 44% of revenue.",
              source_url: "https://example.com/10q.pdf",
            },
          },
        ],
      },
    ],
    coverage: [],
    warnings: [],
  };
}

function knowledgeData(): Knowledge {
  return {
    symbol: "AAPL",
    created_at: "2026-10-01T09:00:00Z",
    engine: "llm",
    concalls: [],
    guidance: [
      {
        metric: "adjusted EBITDA margin",
        statement: "Company targets margin expansion.",
        target: "21%",
        period: "FY26",
        said_in: { doc_id: 14, title: "Concall Transcript Q2", period: "FY25 Q2" },
        status: "raised",
        citation: {
          doc_id: 14,
          title: "Concall Transcript Q2",
          page_start: 7,
          page_end: 8,
          section: "Management",
          quote: "We target margin expansion.",
          source_url: "https://example.com/concall.pdf",
        },
      },
    ],
    warnings: [],
  };
}

function businessData(): BusinessMetrics {
  return {
    symbol: "AAPL",
    updated_at: "2026-10-01T09:00:00Z",
    engine: "lexical",
    kpis: [
      {
        key: "order_book",
        label: "Order book",
        unit: "Cr",
        category: "order_book",
        points: [
          { period: "FY23", value: 9800, citation: { doc_id: 1, title: "Annual Report FY23", page_start: 20, page_end: 20, section: null, quote: "", source_url: null } },
          { period: "FY24", value: 12345, citation: { doc_id: 2, title: "Annual Report FY24", page_start: 20, page_end: 21, section: null, quote: "", source_url: null } },
        ],
      },
    ],
    revenue_mix: [
      {
        period: "FY24",
        dimension: "segment",
        citation: null,
        items: [
          { name: "Software", value: 42000, unit: "Cr", share_pct: 42 },
          { name: "Hardware", value: 31000, unit: "Cr", share_pct: 31 },
        ],
      },
    ],
    market_share: [],
    warnings: [],
  };
}

function valuationData(): ReverseDcf {
  return {
    symbol: "AAPL",
    currency: "USD",
    price: 189.84,
    market_cap: 2_950_000_000_000,
    net_debt: 500_000_000,
    basis: "fcf",
    base_cash_flow: 110_000_000_000,
    discount_rate: 0.12,
    terminal_growth: 0.04,
    years: 10,
    implied_growth_pct: 11.4,
    historical: {
      revenue_cagr_3y: 0.091, // API returns fractions for CAGRs (0.091 = 9.1%)
      revenue_cagr_5y: 0.084,
      profit_cagr_3y: 0.127,
      profit_cagr_5y: 0.101,
    },
    verdict: "reasonable",
    sensitivity: { discount_rates: [], terminal_growths: [], implied_growth_pct: [] },
    notes: ["Implied growth is above the 5-year revenue trend."],
  };
}

function valueChainData(): ValueChain {
  return {
    symbol: "AAPL",
    sector: "Technology",
    industry: "Consumer Electronics",
    customers: [
      {
        name: "Acme Retail Ltd",
        symbol: "ACME",
        relation: "customer",
        detail: "Top distribution partner",
        share_pct: 22,
        origin: "filings",
        citation: { doc_id: 5, title: "10-K", page_start: 8, page_end: 9, section: null, quote: "", source_url: null },
      },
    ],
    suppliers: [],
    competitors: [],
    raw_materials: [
      {
        name: "Cobalt",
        commodity_symbol: "COB",
        price: 28.4,
        currency: "USD",
        change_1m_pct: -1.2,
        change_1y_pct: 6.0,
        cost_share_pct: 4,
        origin: "curated",
        citation: null,
      },
    ],
    updated_at: "2026-10-01T09:00:00Z",
    warnings: [],
  };
}

function resultsData(): ResultsHistory {
  return {
    symbol: "AAPL",
    currency: "USD",
    quarters: [
      { period: "FY25 Q2", period_end: "2026-06-30", revenue: 85000, ebitda: 28000, net_income: 22000, eps: 1.4, ebitda_margin_pct: 32.9, net_margin_pct: 25.9, revenue_yoy_pct: 8.2, revenue_qoq_pct: 2.1, profit_yoy_pct: 9.5, profit_qoq_pct: 3.0, eps_estimate: 1.35, eps_surprise_pct: 3.7 },
      { period: "FY25 Q1", period_end: "2026-03-31", revenue: 83000, ebitda: 27000, net_income: 21000, eps: 1.35, ebitda_margin_pct: 32.5, net_margin_pct: 25.3, revenue_yoy_pct: 7.1, revenue_qoq_pct: 1.5, profit_yoy_pct: 8.0, profit_qoq_pct: 2.6, eps_estimate: 1.3, eps_surprise_pct: 3.8 },
      { period: "FY24 Q4", period_end: "2025-12-31", revenue: 81500, ebitda: 26000, net_income: 20000, eps: 1.3, ebitda_margin_pct: 31.9, net_margin_pct: 24.5, revenue_yoy_pct: 6.4, revenue_qoq_pct: 4.2, profit_yoy_pct: 7.2, profit_qoq_pct: 5.0, eps_estimate: 1.28, eps_surprise_pct: 1.6 },
      { period: "FY24 Q3", period_end: "2025-09-30", revenue: 78000, ebitda: 25000, net_income: 19000, eps: 1.24, ebitda_margin_pct: 32.1, net_margin_pct: 24.4, revenue_yoy_pct: 5.9, revenue_qoq_pct: 3.3, profit_yoy_pct: 6.8, profit_qoq_pct: 4.1, eps_estimate: 1.22, eps_surprise_pct: 1.6 },
      { period: "FY24 Q2", period_end: "2025-06-30", revenue: 75000, ebitda: 24000, net_income: 18000, eps: 1.18, ebitda_margin_pct: 32.0, net_margin_pct: 24.0, revenue_yoy_pct: 5.1, revenue_qoq_pct: 1.9, profit_yoy_pct: 6.0, profit_qoq_pct: 2.8, eps_estimate: 1.16, eps_surprise_pct: 1.7 },
    ],
    scorecard: { label: "strong", reasons: ["Consistent double-digit growth."] },
    warnings: [],
  };
}

function peersData(): PeerKpiTable {
  return {
    symbol: "AAPL",
    peers: ["MSFT", "GOOGL"],
    rows: [
      {
        key: "roce",
        label: "ROCE",
        unit: "%",
        higher_is_better: true,
        values: {
          AAPL: { value: 42.1, unit: "%", period: "FY24", citation: null },
          MSFT: { value: 38.5, unit: "%", period: "FY24", citation: null },
        },
      },
    ],
    financial_rows: [],
    missing: [],
    warnings: [],
  };
}

function fullData(overrides: Partial<ResearchNoteData> = {}): ResearchNoteData {
  return {
    symbol: "AAPL",
    stock: STOCK,
    analysis: analysisWithClaim(),
    knowledge: knowledgeData(),
    business: businessData(),
    valuation: valuationData(),
    valueChain: valueChainData(),
    results: resultsData(),
    peers: peersData(),
    ...overrides,
  };
}

const EMPTY_DATA: ResearchNoteData = {
  symbol: "ZZZ",
  stock: null,
  analysis: null,
  knowledge: null,
  business: null,
  valuation: null,
  valueChain: null,
  results: null,
  peers: null,
};

describe("buildResearchNote — full fixture", () => {
  it("includes a citation label and a numbered sources list", () => {
    const note = buildResearchNote(fullData());

    // A finding citation is rendered at the end of its investment bullet.
    expect(note).toContain("[Annual Report FY24, p.12]");

    // Every cited document is enumerated in the sources section.
    expect(note).toContain("## Sources");
    expect(note).toMatch(/^\s*1\. \*\*Annual Report FY24\*\*/m);

    // The required sections all render.
    for (const heading of [
      "## Investment summary",
      "## Business",
      "## Results — last 4 quarters",
      "## Valuation",
      "## Management guidance",
      "## Value chain",
    ]) {
      expect(note).toContain(heading);
    }

    // The disclaimer is always present.
    expect(note).toContain("Generated from company filings; not investment advice");
  });

  it("renders the last-4-quarters results table and valuation verdict", () => {
    const note = buildResearchNote(fullData());
    expect(note).toContain("| FY25 Q2 |");
    expect(note).toContain("**Verdict:** reasonable");
  });
});

describe("buildResearchNote — all sources missing", () => {
  it("still renders every heading and a 'Not available' line", () => {
    const note = buildResearchNote(EMPTY_DATA);

    for (const heading of [
      "## Investment summary",
      "## Business",
      "## Results — last 4 quarters",
      "## Valuation",
      "## Management guidance",
      "## Value chain",
    ]) {
      expect(note).toContain(heading);
    }
    expect(note).toContain("Not available");
    // More than one "Not available" — one per optional section.
    expect(note.split("Not available").length).toBeGreaterThan(3);
  });
});

describe("buildResearchNote — HTML escaping", () => {
  it("escapes <script> that appears inside a claim", () => {
    const note = buildResearchNote(
      fullData({ analysis: analysisWithClaim("Injected <script>alert(1)</script> claim") }),
    );

    expect(note).toContain("&lt;script&gt;");
    expect(note).not.toContain("<script>alert(1)</script>");

    // Escaping holds in the print-ready HTML too.
    const html = toPrintHtml(note);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

// The note must never throw when the underlying services are down.
vi.mock("../api/base", () => ({
  api: { get: vi.fn().mockRejectedValue(new Error("network down")) },
  extractApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

describe("gatherResearchData — fault tolerance", () => {
  it("resolves with null sources on failure and still builds a note", async () => {
    const data = await gatherResearchData("AAPL");

    expect(data.stock).toBeNull();
    expect(data.analysis).toBeNull();
    expect(data.knowledge).toBeNull();
    expect(data.business).toBeNull();
    expect(data.valuation).toBeNull();
    expect(data.valueChain).toBeNull();
    expect(data.results).toBeNull();
    expect(data.peers).toBeNull();

    const note = buildResearchNote(data);
    expect(note).toContain("## Investment summary");
    expect(note).toContain("Not available");
  });
});
describe("research note units (QC)", () => {
  it("formats fractional rates as percent and keeps implied growth as-is", async () => {
    const { buildResearchNote } = await import("../api/researchNote");
    const note = buildResearchNote({
      symbol: "X",
      valuation: {
        symbol: "X", currency: "USD", price: 1, market_cap: 1, net_debt: 0, basis: "fcf", base_cash_flow: 1,
        discount_rate: 0.1, terminal_growth: 0.03, years: 10, implied_growth_pct: 19.4,
        historical: { revenue_cagr_3y: 0.018, revenue_cagr_5y: null, profit_cagr_3y: 0.039, profit_cagr_5y: null },
        verdict: "priced_for_perfection", sensitivity: { discount_rates: [], terminal_growths: [], implied_growth_pct: [] }, notes: [],
      },
    } as never);
    expect(note).toContain("implied growth 19.4%");
    expect(note).toContain("discount 10%");
    expect(note).toContain("terminal growth 3%");
    expect(note).toContain("3y 1.8%");
  });
});
