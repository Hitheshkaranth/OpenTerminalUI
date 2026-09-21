import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PortfolioImportDrawer } from "../../src/components/portfolio/PortfolioImportDrawer";
import * as apiModule from "../../src/api/portfolioImport";

vi.mock("../../src/api/portfolioImport", async (importOriginal) => {
  // Stub only the network calls; keep the pure row-mapping helper real.
  const actual = await importOriginal<typeof import("../../src/api/portfolioImport")>();
  return {
    ...actual,
    importPortfolio: vi.fn(),
    fetchKiteHoldings: vi.fn(),
  };
});

describe("PortfolioImportDrawer", () => {
  const mockImportPortfolio = vi.mocked(apiModule.importPortfolio);
  const mockFetchKiteHoldings = vi.mocked(apiModule.fetchKiteHoldings);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <PortfolioImportDrawer open={false} onClose={() => {}} onImported={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders modal when open", () => {
    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Import holdings")).toBeInTheDocument();
  });

  it("has two tabs: CSV file and Zerodha Kite", () => {
    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );
    expect(screen.getByText("CSV file")).toBeInTheDocument();
    expect(screen.getByText("Zerodha Kite")).toBeInTheDocument();
  });

  it("CSV tab shows file input and paste textarea", () => {
    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );
    expect(screen.getByText("Or paste CSV")).toBeInTheDocument();
  });

  it("parsing CSV via textarea shows preview", async () => {
    const onImported = vi.fn();
    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={onImported} />,
    );

    const label = screen.getByText("Or paste CSV");
    const textarea = label.parentElement?.querySelector("textarea");
    if (!textarea) throw new Error("textarea not found");

    fireEvent.change(textarea, {
      target: {
        value: "ticker,quantity,avg_buy_price\nTCS,100,3000\nINFY,200,1500",
      },
    });

    const parseBtn = screen.getByText("Parse");
    fireEvent.click(parseBtn);

    await waitFor(() => {
      expect(screen.getByText("Detected: generic")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("2 rows")).toBeInTheDocument();
    });

    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("INFY")).toBeInTheDocument();
  });

  it("Import button calls importPortfolio with correct payload", async () => {
    mockImportPortfolio.mockResolvedValue({
      imported: 2,
      skipped: 0,
      mode: "append",
      errors: [],
    });

    const onImported = vi.fn();
    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={onImported} />,
    );

    // Paste CSV
    const label = screen.getByText("Or paste CSV");
    const textarea = label.parentElement?.querySelector("textarea");
    if (!textarea) throw new Error("textarea not found");

    fireEvent.change(textarea, {
      target: { value: "ticker,quantity,avg_buy_price\nTCS,100,3000\nINFY,200,1500" },
    });

    fireEvent.click(screen.getByText("Parse"));

    await waitFor(() => {
      expect(screen.getByText("Import 2 holdings")).toBeInTheDocument();
    });

    const importBtn = screen.getByRole("button", { name: /import 2 holdings/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mockImportPortfolio).toHaveBeenCalledWith({
        source: "csv",
        mode: "append",
        rows: [
          { ticker: "TCS", quantity: 100, avg_buy_price: 3000, buy_date: null, exchange: null },
          { ticker: "INFY", quantity: 200, avg_buy_price: 1500, buy_date: null, exchange: null },
        ],
      });
    });

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith({
        imported: 2,
        skipped: 0,
        mode: "append",
        errors: [],
      });
    });
  });

  it("result summary rendered after import", async () => {
    mockImportPortfolio.mockResolvedValue({
      imported: 2,
      skipped: 0,
      mode: "append",
      errors: [],
    });

    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );

    // Paste CSV
    const label = screen.getByText("Or paste CSV");
    const textarea = label.parentElement?.querySelector("textarea");
    if (!textarea) throw new Error("textarea not found");

    fireEvent.change(textarea, {
      target: { value: "ticker,quantity,avg_buy_price\nTCS,100,3000\nINFY,200,1500" },
    });

    fireEvent.click(screen.getByText("Parse"));

    await waitFor(() => {
      expect(screen.getByText("Import 2 holdings")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /import 2 holdings/i }));

    await waitFor(() => {
      expect(screen.getByText("Imported 2")).toBeInTheDocument();
      expect(screen.getByText("Skipped 0")).toBeInTheDocument();
    });
  });

  it("Import button is disabled when 0 rows", () => {
    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );
    const btn = screen.getByRole("button", { name: /import 0 holdings/i });
    expect(btn).toBeDisabled();
  });

  it("Kite tab shows fetch button", () => {
    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );

    // Switch to Kite tab
    fireEvent.click(screen.getByText("Zerodha Kite"));
    expect(screen.getByText("Fetch holdings from Kite")).toBeInTheDocument();
  });

  it("Kite tab shows error on 400 response", async () => {
    mockFetchKiteHoldings.mockRejectedValue({
      response: {
        status: 400,
        data: { detail: "KITE_API_KEY not set" },
      },
    });

    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );

    fireEvent.click(screen.getByText("Zerodha Kite"));
    fireEvent.click(screen.getByText("Fetch holdings from Kite"));

    await waitFor(() => {
      expect(screen.getByText("Configure KITE_* keys in .env or log in via Settings")).toBeInTheDocument();
    });
  });

  it("Kite tab shows error on 401 response", async () => {
    mockFetchKiteHoldings.mockRejectedValue({
      response: {
        status: 401,
        data: { detail: "No access token" },
      },
    });

    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );

    fireEvent.click(screen.getByText("Zerodha Kite"));
    fireEvent.click(screen.getByText("Fetch holdings from Kite"));

    await waitFor(() => {
      expect(screen.getByText("Configure KITE_* keys in .env or log in via Settings")).toBeInTheDocument();
    });
  });

  it("Kite tab previews on success", async () => {
    mockFetchKiteHoldings.mockResolvedValue({
      source: "kite",
      fetched_at: new Date().toISOString(),
      holdings: [
        { symbol: "RELIANCE", exchange: "NSE", isin: "INE002A01018", quantity: 100, average_price: 2400, last_price: 2500, pnl: 10000, product: "CNC" },
      ],
    });

    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );

    fireEvent.click(screen.getByText("Zerodha Kite"));
    fireEvent.click(screen.getByText("Fetch holdings from Kite"));

    await waitFor(() => {
      expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    });

    expect(screen.getByText("NSE")).toBeInTheDocument();
  });

  it("Import button disabled when Kite fetch fails", async () => {
    mockFetchKiteHoldings.mockRejectedValue({
      response: {
        status: 500,
        data: { detail: "Internal error" },
      },
    });

    render(
      <PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />,
    );

    fireEvent.click(screen.getByText("Zerodha Kite"));
    fireEvent.click(screen.getByText("Fetch holdings from Kite"));

    await waitFor(() => {
      expect(screen.getByText("Import 0 holdings")).toBeInTheDocument();
    });

    const importBtn = screen.getByRole("button", { name: /import 0 holdings/i });
    expect(importBtn).toBeDisabled();
  });

  it("reset state when open flips to true", async () => {
    const { rerender } = render(
      <PortfolioImportDrawer open={false} onClose={() => {}} onImported={() => {}} />,
    );

    rerender(<PortfolioImportDrawer open onClose={() => {}} onImported={() => {}} />);

    // Should start fresh
    const label = screen.getByText("Or paste CSV");
    const textarea = label.parentElement?.querySelector("textarea");
    if (!textarea) throw new Error("textarea not found");
    expect(textarea).toHaveValue("");
  });
});