import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WatchlistImportPanel } from "../WatchlistImportPanel";

const addSymbols = vi.hoisted(() => vi.fn());
vi.mock("../../../api/client", () => ({ addWatchlistSymbols: addSymbols }));

function renderImport(symbols = ["AAPL"]) {
  const onImported = vi.fn();
  const onClose = vi.fn();
  const onPendingChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const result = render(<QueryClientProvider client={client}><WatchlistImportPanel watchlist={{ id: "wl-1", name: "Research", symbols }} onImported={onImported} onClose={onClose} onPendingChange={onPendingChange} /></QueryClientProvider>);
  return { ...result, onImported, onClose, onPendingChange };
}

describe("Watchlist import confirmation", () => {
  beforeEach(() => { addSymbols.mockReset(); });

  it("never mutates before review confirmation and sends only ready symbols in one call", async () => {
    addSymbols.mockResolvedValue({ symbols: ["AAPL", "MSFT"] });
    const { onImported } = renderImport();
    fireEvent.change(screen.getByLabelText("Symbols or CSV contents"), { target: { value: "AAPL\nMSFT\nmsft\nnot a symbol" } });
    expect(addSymbols).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(addSymbols).not.toHaveBeenCalled();
    expect(screen.getByText("Already present")).toBeInTheDocument();
    expect(screen.getByText("Duplicate", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Invalid", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import reviewed symbols (1)" }));
    await waitFor(() => expect(addSymbols).toHaveBeenCalledExactlyOnceWith("wl-1", ["MSFT"]));
    expect(await screen.findByRole("status")).toHaveTextContent("Added 1 symbol to Research.");
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("retains the reviewed rows on failure and permits an explicit retry", async () => {
    addSymbols.mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce({});
    const { onImported } = renderImport();
    const text = screen.getByLabelText("Symbols or CSV contents");
    fireEvent.change(text, { target: { value: "MSFT\nNVDA" } });
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    fireEvent.click(screen.getByRole("button", { name: "Import reviewed symbols (2)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(text).toHaveValue("MSFT\nNVDA");
    expect(screen.getByRole("table", { name: "Symbol import preview for Research" })).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import reviewed symbols (2)" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(addSymbols).toHaveBeenCalledTimes(2);
  });

  it("clears a stale review when text changes and prevents empty or invalid submission", () => {
    renderImport();
    const text = screen.getByLabelText("Symbols or CSV contents");
    fireEvent.change(text, { target: { value: "MSFT" } });
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    fireEvent.change(text, { target: { value: "AAPL" } });
    expect(screen.queryByRole("button", { name: /Import reviewed symbols/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(screen.getByRole("button", { name: "Import reviewed symbols (0)" })).toBeDisabled();
    expect(addSymbols).not.toHaveBeenCalled();
  });

  it("disables editing, closing, and repeat submissions while pending", async () => {
    let resolve!: (value: unknown) => void;
    addSymbols.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { onPendingChange } = renderImport();
    fireEvent.change(screen.getByLabelText("Symbols or CSV contents"), { target: { value: "MSFT" } });
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    const confirm = screen.getByRole("button", { name: "Import reviewed symbols (1)" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(screen.getByLabelText("Symbols or CSV contents")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close symbol import" })).toBeDisabled();
    expect(addSymbols).toHaveBeenCalledTimes(1);
    expect(onPendingChange).toHaveBeenCalledWith(true);
    resolve({});
    await screen.findByText("Added 1 symbol to Research.");
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it("reports file limits before reading and retains a non-mutating workflow", async () => {
    renderImport();
    const file = new File(["MSFT"], "oversized.csv", { type: "text/csv" });
    Object.defineProperty(file, "size", { value: 65537 });
    fireEvent.change(screen.getByLabelText("Choose a TXT or CSV file"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("64 KiB");
    expect(addSymbols).not.toHaveBeenCalled();
  });

  it("loads a chosen CSV into the editor without adding anything until review and confirmation", async () => {
    addSymbols.mockResolvedValue({});
    renderImport();
    const file = new File(["symbol,name\nMSFT,Microsoft"], "symbols.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "symbol,name\nMSFT,Microsoft" });
    fireEvent.change(screen.getByLabelText("Choose a TXT or CSV file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText("Symbols or CSV contents")).toHaveValue("symbol,name\nMSFT,Microsoft"));
    expect(addSymbols).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(screen.getByRole("table", { name: "Symbol import preview for Research" })).toBeInTheDocument();
    expect(addSymbols).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import reviewed symbols (1)" }));
    await waitFor(() => expect(addSymbols).toHaveBeenCalledExactlyOnceWith("wl-1", ["MSFT"]));
  });

  it("previews native TradingView comma entries with unique React keys and explicit skipped sections", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      renderImport();
      fireEvent.change(screen.getByLabelText("Symbols or CSV contents"), { target: { value: "###TECH,NASDAQ:AAPL,NASDAQ:MSFT" } });
      fireEvent.click(screen.getByRole("button", { name: "Review import" }));
      expect(screen.getByText("NASDAQ:AAPL")).toBeInTheDocument();
      expect(screen.getByText("NASDAQ:MSFT")).toBeInTheDocument();
      expect(screen.getByText("Section label, not a symbol; it will be skipped.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import reviewed symbols (2)" })).toBeEnabled();
      expect(errors.mock.calls.some((args) => args.some((arg) => String(arg).includes("same key")))).toBe(false);
      expect(addSymbols).not.toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });
});
