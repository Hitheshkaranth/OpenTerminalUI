import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchBusinessMetrics,
  fetchReverseDcf,
  fetchValueChain,
  type BusinessMetrics,
  type ReverseDcf,
  type ValueChain,
} from "../api/businessResearch";

import { BusinessMetricsSection } from "../components/business/BusinessMetricsSection";
import { ReverseDcfCard } from "../components/business/ReverseDcfCard";
import { ValueChainSection } from "../components/business/ValueChainSection";

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    LineChart: Stub,
    BarChart: Stub,
    Line: Stub,
    Bar: Stub,
    CartesianGrid: Stub,
    XAxis: Stub,
    YAxis: Stub,
    Tooltip: Stub,
    Legend: Stub,
  };
});

vi.mock("../api/businessResearch", () => ({
  fetchBusinessMetrics: vi.fn(),
  extractBusinessMetrics: vi.fn(),
  fetchValueChain: vi.fn(),
  extractValueChain: vi.fn(),
  fetchReverseDcf: vi.fn(),
}));

const mockFetchBusinessMetrics = fetchBusinessMetrics as unknown as ReturnType<typeof vi.fn>;
const mockFetchReverseDcf = fetchReverseDcf as unknown as ReturnType<typeof vi.fn>;
const mockFetchValueChain = fetchValueChain as unknown as ReturnType<typeof vi.fn>;

function makeBusinessMetrics(): BusinessMetrics {
  return {
    symbol: "TCS",
    engine: "llm",
    updated_at: null,
    warnings: [],
    revenue_mix: [],
    market_share: [],
    kpis: [
      {
        key: "revenue",
        label: "Revenue",
        unit: "Rs Cr",
        category: "financial",
        points: [
          { period: "FY24", value: 1000, citation: null },
          { period: "FY23", value: 900, citation: null },
        ],
      },
      {
        key: "arpu",
        label: "ARPU",
        unit: "₹",
        category: "customers",
        points: [{ period: "Q3", value: 42.5, citation: null }],
      },
    ],
  };
}

function makeReverseDcf(over: Partial<ReverseDcf> = {}): ReverseDcf {
  const base: ReverseDcf = {
    symbol: "TCS",
    currency: "INR",
    price: 3400,
    market_cap: null,
    net_debt: null,
    basis: "fcf",
    base_cash_flow: null,
    discount_rate: 0.12,
    terminal_growth: 0.04,
    years: 10,
    implied_growth_pct: null,
    historical: {
      revenue_cagr_3y: null,
      revenue_cagr_5y: 0.12,
      profit_cagr_3y: null,
      profit_cagr_5y: 0.1,
    },
    verdict: "undemanding",
    sensitivity: {
      discount_rates: [],
      terminal_growths: [],
      implied_growth_pct: [],
    },
    notes: [],
  };
  return { ...base, ...over };
}

function makeValueChain(over: Partial<ValueChain> = {}): ValueChain {
  const base: ValueChain = {
    symbol: "TCS",
    sector: "Technology",
    industry: "IT Services",
    customers: [
      {
        name: "Acme Corp",
        symbol: "ACME",
        relation: "customer",
        detail: "Cloud platform",
        share_pct: 15,
        origin: "filings",
        citation: null,
      },
    ],
    suppliers: [],
    competitors: [],
    raw_materials: [
      {
        name: "Silicon",
        commodity_symbol: "SILI",
        price: 50,
        currency: "USD",
        change_1m_pct: -0.02,
        change_1y_pct: -0.05,
        cost_share_pct: 10,
        origin: "filings",
        citation: null,
      },
    ],
    warnings: [],
    updated_at: null,
  };
  return { ...base, ...over };
}

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return {
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </MemoryRouter>,
    ),
    client,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BusinessMetricsSection - KPIs", () => {
  beforeEach(() => {
    mockFetchBusinessMetrics.mockReset();
  });

  it("renders the KPI title and its unit", async () => {
    mockFetchBusinessMetrics.mockResolvedValue(makeBusinessMetrics());

    renderWithProviders(<BusinessMetricsSection symbol="TCS" />);

    await waitFor(() => {
      expect(screen.getByText("Revenue")).toBeInTheDocument();
    });
    expect(screen.getByText(/in Rs Cr/)).toBeInTheDocument();
  });

  it("shows the loading state before data resolves", async () => {
    mockFetchBusinessMetrics.mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<BusinessMetricsSection symbol="TCS" />);

    expect(screen.getByText("Loading business metrics…")).toBeInTheDocument();
  });
});

describe("ReverseDcfCard", () => {
  beforeEach(() => {
    mockFetchReverseDcf.mockReset();
  });

  it("renders the verdict badge and the not-meaningful note when verdict is not_meaningful", async () => {
    mockFetchReverseDcf.mockResolvedValue(makeReverseDcf({ verdict: "not_meaningful", implied_growth_pct: null }));

    renderWithProviders(<ReverseDcfCard symbol="TCS" compact />);

    await waitFor(() => {
      expect(screen.getByText("Not meaningful")).toBeInTheDocument();
    });
    expect(screen.getByText("Implied growth is not meaningful with the current inputs.")).toBeInTheDocument();
  });

  it("renders a readable verdict badge without the not-meaningful note", async () => {
    mockFetchReverseDcf.mockResolvedValue(makeReverseDcf({ verdict: "undemanding", implied_growth_pct: 18.5 })); // API returns percent (18.5 = 18.5%)

    renderWithProviders(<ReverseDcfCard symbol="TCS" compact />);

    await waitFor(() => {
      expect(screen.getByText("Undemanding")).toBeInTheDocument();
    });
    expect(screen.queryByText("Implied growth is not meaningful with the current inputs.")).not.toBeInTheDocument();
    expect(screen.getByText("18.5%")).toBeInTheDocument();
  });
});

describe("ValueChainSection", () => {
  beforeEach(() => {
    mockFetchValueChain.mockReset();
  });

  it("links a listed customer to its hub security URL", async () => {
    mockFetchValueChain.mockResolvedValue(makeValueChain());

    renderWithProviders(<ValueChainSection symbol="TCS" />);

    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    });
    const link = screen.getByText("Acme Corp").closest("a");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/equity/security/ACME");
  });

  it("marks a negative 1Y raw-material change with the negative colour class", async () => {
    mockFetchValueChain.mockResolvedValue(makeValueChain());

    renderWithProviders(<ValueChainSection symbol="TCS" />);

    await waitFor(() => {
      expect(screen.getByText("-5%")).toBeInTheDocument();
    });
    expect(screen.getByText("-5%")).toHaveClass("text-terminal-neg");
  });
});