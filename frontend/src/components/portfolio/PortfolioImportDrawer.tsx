import { useEffect, useMemo, useState } from "react";
import { TerminalModal } from "../terminal/TerminalModal";
import { TerminalTabs } from "../terminal/TerminalTabs";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalTable } from "../terminal/TerminalTable";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalBadge } from "../terminal/TerminalBadge";
import {
  importPortfolio,
  fetchKiteHoldings,
  kiteHoldingsToImportRows,
  type ImportRow,
  type ImportResponse,
  type KiteHolding,
} from "../../api/portfolioImport";
import { parsePortfolioCsv, type CsvParseResult } from "../../utils/portfolioCsv";

type Props = {
  open: boolean;
  onClose: () => void;
  onImported: (r: ImportResponse) => void;
};

type KitePreview = KiteHolding;

export function PortfolioImportDrawer({ open, onClose, onImported }: Props) {
  // Reset state when drawer opens
  useEffect(() => {
    if (open) {
      setTab("csv");
      setFileRows([]);
      setParsedResult(null);
      setKiteRows([]);
      setKiteLoading(false);
      setKiteError(null);
      setMode("append");
      setImporting(false);
      setImportResult(null);
      setPasteText("");
    }
  }, [open]);

  const [tab, setTab] = useState("csv");
  const [pasteText, setPasteText] = useState("");
  const [parsedResult, setParsedResult] = useState<CsvParseResult | null>(null);
  const [fileRows, setFileRows] = useState<ImportRow[]>([]);
  const [kiteRows, setKiteRows] = useState<KitePreview[]>([]);
  const [kiteLoading, setKiteLoading] = useState(false);
  const [kiteError, setKiteError] = useState<string | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);

  const activeRows: ImportRow[] = useMemo(() => {
    if (tab === "kite") {
      return kiteHoldingsToImportRows(kiteRows);
    }
    return fileRows;
  }, [tab, fileRows, kiteRows]);

  const handlePaste = () => {
    if (!pasteText.trim()) {
      setParsedResult(null);
      setFileRows([]);
      return;
    }
    const result = parsePortfolioCsv(pasteText);
    setParsedResult(result);
    setFileRows(result.rows);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const result = parsePortfolioCsv(text);
      setParsedResult(result);
      setFileRows(result.rows);
    };
    reader.readAsText(file);
  };

  const handleKiteFetch = async () => {
    setKiteLoading(true);
    setKiteError(null);
    try {
      const res = await fetchKiteHoldings();
      setKiteRows(res.holdings);
    } catch (e: unknown) {
      // The backend's `detail` is actionable (missing key / expired token); prefer it
      // over axios' generic "Request failed with status code N" for every status.
      const err = e as { response?: { status?: number; data?: { detail?: unknown } }; message?: string };
      const detail = typeof err?.response?.data?.detail === "string" ? err.response.data.detail : null;
      const status = err?.response?.status;
      setKiteError(detail || (status ? `HTTP ${status}: Kite request failed` : err?.message || "Failed to fetch Kite holdings"));
      setKiteRows([]);
    } finally {
      setKiteLoading(false);
    }
  };

  const handleImport = async () => {
    if (activeRows.length === 0 || importing) return;
    setImporting(true);
    setImportResult(null);
    try {
      const source = tab === "kite" ? ("kite" as const) : "csv";
      const result = await importPortfolio({ source, mode, rows: activeRows });
      setImportResult(result);
      onImported(result);
    } catch (e) {
      setImportResult({
        imported: 0,
        skipped: 0,
        mode,
        errors: [{ row: 0, ticker: null, reason: e instanceof Error ? e.message : "Import failed" }],
      });
    } finally {
      setImporting(false);
    }
  };

  const tabs = [
    { id: "csv", label: "CSV file" },
    { id: "kite", label: "Zerodha Kite" },
  ];

  const previewColumns = [
    { key: "ticker", label: "Ticker", render: (r: ImportRow) => r.ticker },
    { key: "qty", label: "Qty", render: (r: ImportRow) => r.quantity },
    { key: "avg", label: "Avg", render: (r: ImportRow) => r.avg_buy_price.toFixed(2) },
    { key: "date", label: "Date", render: (r: ImportRow) => r.buy_date ?? "-" },
  ];

  const kiteColumns = [
    { key: "symbol", label: "Symbol", render: (r: KitePreview) => r.symbol },
    { key: "exchange", label: "Exchange", render: (r: KitePreview) => r.exchange },
    { key: "qty", label: "Qty", render: (r: KitePreview) => r.quantity },
    { key: "avg", label: "Avg", render: (r: KitePreview) => r.average_price.toFixed(2) },
    { key: "last", label: "Last", render: (r: KitePreview) => r.last_price?.toFixed(2) ?? "-" },
    { key: "pnl", label: "P&L", render: (r: KitePreview) => r.pnl?.toFixed(2) ?? "-" },
  ];

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title="Import holdings"
      size="lg"
    >
      <div className="flex flex-col gap-3">
        <TerminalTabs items={tabs} value={tab} onChange={setTab} />

        {/* CSV Tab */}
        {tab === "csv" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-wide text-terminal-muted">Upload CSV</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="text-xs text-terminal-muted"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-wide text-terminal-muted">Or paste CSV</label>
              <TerminalInput
                as="textarea"
                className="min-h-24 font-mono text-xs"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <TerminalButton size="sm" onClick={handlePaste}>
                Parse
              </TerminalButton>
            </div>

            {parsedResult && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-terminal-accent">
                    Detected: {parsedResult.detectedFormat}
                  </span>
                  <span className="text-terminal-muted">
                    {parsedResult.rows.length} rows
                  </span>
                  <span className={parsedResult.errors.length > 0 ? "text-terminal-neg" : "text-terminal-muted"}>
                    {parsedResult.errors.length} errors
                  </span>
                </div>

                {parsedResult.errors.length > 0 && (
                  <div className="flex flex-col gap-1 rounded border border-terminal-neg/30 bg-terminal-neg/5 px-2 py-1.5">
                    {parsedResult.errors.map((err, i) => (
                      <div key={i} className="text-[11px] text-terminal-neg">
                        Line {err.line}: {err.reason}
                      </div>
                    ))}
                  </div>
                )}

                {parsedResult.rows.length > 0 && (
                  <div className="mt-1">
                    <div className="mb-1 text-[11px] text-terminal-muted">Preview (first 20 rows)</div>
                    <TerminalTable
                      columns={previewColumns}
                      rows={parsedResult.rows.slice(0, 20)}
                      rowKey={(r, i) => `${r.ticker}-${i}`}
                      density="compact"
                    />
                    {parsedResult.rows.length > 20 && (
                      <div className="mt-1 text-[11px] text-terminal-muted">
                        Showing 20 of {parsedResult.rows.length} rows
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Kite Tab */}
        {tab === "kite" && (
          <div className="flex flex-col gap-3">
            <TerminalButton size="sm" variant="accent" onClick={handleKiteFetch} loading={kiteLoading}>
              Fetch holdings from Kite
            </TerminalButton>

            {kiteError && (
              <div className="rounded border border-terminal-neg/30 bg-terminal-neg/5 px-2 py-1.5">
                <div className="text-xs text-terminal-neg">{kiteError}</div>
                <div className="mt-1 text-[11px] text-terminal-muted">
                  Configure KITE_* keys in .env or log in via Settings
                </div>
              </div>
            )}

            {kiteRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-terminal-muted">{kiteRows.length} holdings fetched</div>
                <TerminalTable
                  columns={kiteColumns}
                  rows={kiteRows}
                  rowKey={(r, i) => `${r.exchange}:${r.symbol}-${i}`}
                  density="compact"
                />
              </div>
            )}
          </div>
        )}

        {/* Footer: mode + import */}
        <div className="flex flex-col gap-2 border-t border-terminal-border pt-3">
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1 text-terminal-muted">
              <input
                type="radio"
                name="importMode"
                value="append"
                checked={mode === "append"}
                onChange={() => setMode("append")}
                className="accent-terminal-accent"
              />
              Append
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
                className="accent-terminal-neg"
              />
              Replace all holdings
            </label>
            {mode === "replace" && (
              <TerminalBadge variant="danger" size="sm">
                This deletes every existing holding
              </TerminalBadge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <TerminalButton
              variant="accent"
              onClick={handleImport}
              disabled={activeRows.length === 0 || importing}
              loading={importing}
            >
              Import {activeRows.length} holdings
            </TerminalButton>
            {importResult ? (
              <TerminalButton size="sm" onClick={onClose}>
                Done
              </TerminalButton>
            ) : null}
          </div>

          {importResult && (
            <div className="flex flex-col gap-1 rounded border border-terminal-border bg-terminal-panel px-2 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <TerminalBadge variant="success">
                  Imported {importResult.imported}
                </TerminalBadge>
                <TerminalBadge variant="neutral">
                  Skipped {importResult.skipped}
                </TerminalBadge>
              </div>
              {importResult.errors.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {importResult.errors.slice(0, 10).map((err, i) => (
                    <div key={i} className="text-[11px] text-terminal-neg">
                      Row {err.row}: {err.reason}
                      {err.ticker ? ` (${err.ticker})` : ""}
                    </div>
                  ))}
                  {importResult.errors.length > 10 && (
                    <div className="text-[11px] text-terminal-muted">
                      ... and {importResult.errors.length - 10} more errors
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </TerminalModal>
  );
}