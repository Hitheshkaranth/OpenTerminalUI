import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, X } from "lucide-react";

import { addWatchlistSymbols } from "../../api/client";
import { extractApiErrorMessage } from "../../api/base";
import { MAX_WATCHLIST_IMPORT_BYTES, parseWatchlistImport, type WatchlistImportPreview } from "../../utils/watchlistImport";
import { TerminalButton } from "../terminal/TerminalButton";

type Props = {
  watchlist: { id: string; name: string; symbols: string[] };
  onImported: () => void;
  onClose: () => void;
  onPendingChange?: (pending: boolean) => void;
};
const statusLabels = { ready: "Ready to add", existing: "Already present", duplicate: "Duplicate", invalid: "Invalid" };

export function WatchlistImportPanel({ watchlist, onImported, onClose, onPendingChange }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<WatchlistImportPreview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileReading, setFileReading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const fileSequence = useRef(0);
  const submitInFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: (symbols: string[]) => addWatchlistSymbols(watchlist.id, symbols),
    retry: false,
    onMutate: () => { onPendingChange?.(true); },
    onSuccess: (_data, symbols) => {
      setSuccess(`Added ${symbols.length} ${symbols.length === 1 ? "symbol" : "symbols"} to ${watchlist.name}.`);
      setPreview(null);
      setText("");
      onImported();
    },
    onSettled: () => { submitInFlight.current = false; onPendingChange?.(false); },
  });
  const counts = useMemo(() => {
    const result = { ready: 0, existing: 0, duplicate: 0, invalid: 0 };
    for (const row of preview?.rows || []) result[row.status] += 1;
    return result;
  }, [preview]);
  const disabled = mutation.isPending || fileReading;
  const clearReview = () => { setPreview(null); setFileError(null); setSuccess(null); mutation.reset(); };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const sequence = ++fileSequence.current;
    clearReview();
    setText("");
    if (!/\.(csv|txt)$/i.test(file.name)) { setFileError("Choose a .txt or .csv file."); return; }
    if (file.size > MAX_WATCHLIST_IMPORT_BYTES) { setFileError("Choose a TXT or CSV file no larger than 64 KiB."); return; }
    setFileReading(true);
    try {
      const content = await file.text();
      if (sequence === fileSequence.current) setText(content);
    } catch { if (sequence === fileSequence.current) setFileError("This file could not be read. Try pasting its contents instead."); }
    finally { if (sequence === fileSequence.current) setFileReading(false); }
  };

  const confirmImport = () => {
    if (!preview?.symbols.length || preview.error || disabled || submitInFlight.current) return;
    // Recheck existing membership immediately before submitting, without changing the reviewed syntax.
    const membership = new Set(watchlist.symbols.map((symbol) => symbol.toUpperCase()));
    const reviewed = preview.symbols.filter((symbol) => !membership.has(symbol));
    if (!reviewed.length) {
      setPreview(parseWatchlistImport(text, watchlist.symbols));
      return;
    }
    submitInFlight.current = true;
    mutation.mutate(reviewed);
  };

  return (
    <section className="rounded border border-terminal-border bg-terminal-panel p-4 font-sans" aria-labelledby="watchlist-import-heading">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="watchlist-import-heading" className="text-sm font-semibold text-terminal-text">Import symbols into {watchlist.name}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-terminal-muted">Paste one symbol per line, exchange-prefixed comma-separated TXT from TradingView, or a CSV with a symbol or ticker header. An optional exchange column supports NSE, BSE, NYSE, and NASDAQ. Explicit prefixes and suffixes are preserved.</p></div>
        <button type="button" disabled={disabled} aria-label="Close symbol import" onClick={onClose} className="rounded p-2 text-terminal-muted hover:text-terminal-text focus-visible:outline focus-visible:outline-terminal-accent disabled:opacity-50"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,1.7fr)]">
        <div>
          <label htmlFor="watchlist-import-text" className="block text-xs font-medium text-terminal-text">Symbols or CSV contents</label>
          <textarea id="watchlist-import-text" className="mt-2 min-h-36 w-full resize-y rounded border border-terminal-border bg-terminal-bg p-3 font-mono text-xs text-terminal-text outline-none focus-visible:ring-1 focus-visible:ring-terminal-accent"
            value={text} disabled={disabled} spellCheck={false} aria-describedby="watchlist-import-limits" placeholder={'symbol\nAAPL\nNASDAQ:MSFT\nRELIANCE.NS'}
            onChange={(event) => { fileSequence.current += 1; setText(event.target.value); clearReview(); }} />
          <p id="watchlist-import-limits" className="mt-1 text-[11px] leading-5 text-terminal-muted">Up to 500 nonempty rows, 40 characters per symbol, and 64 KiB. Review checks syntax only; listings, exchange identity, and market data availability are not verified.</p>
          <label className="mt-3 block text-xs text-terminal-text">Choose a TXT or CSV file<input type="file" accept=".txt,.csv,text/plain,text/csv" disabled={disabled} onChange={readFile} className="mt-2 block max-w-full text-xs text-terminal-muted file:mr-3 file:rounded-sm file:border file:border-terminal-border file:bg-terminal-bg file:px-2 file:py-2 file:text-terminal-text focus-visible:outline focus-visible:outline-terminal-accent" /></label>
          <TerminalButton className="mt-3" size="sm" disabled={disabled || !text.trim()} leftIcon={<Upload size={13} aria-hidden="true" />} onClick={() => { mutation.reset(); setSuccess(null); setFileError(null); setPreview(parseWatchlistImport(text, watchlist.symbols)); }}>Review import</TerminalButton>
          {fileReading && <p role="status" className="mt-2 text-xs text-terminal-muted">Reading file…</p>}
        </div>
        <div>
          {preview && !preview.error ? <>
            <h3 className="text-xs font-semibold text-terminal-text">Review before adding</h3>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-terminal-muted" aria-live="polite">{Object.entries(counts).map(([status, count]) => <span key={status}>{count} {statusLabels[status as keyof typeof statusLabels].toLowerCase()}</span>)}</div>
            <div className="mt-3 max-h-64 overflow-auto rounded border border-terminal-border">
              <table className="w-full text-left text-xs"><caption className="sr-only">Symbol import preview for {watchlist.name}</caption><thead className="sticky top-0 bg-terminal-bg text-terminal-muted"><tr><th scope="col" className="p-2">Line</th><th scope="col" className="p-2">Symbol</th><th scope="col" className="p-2">Review</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={`${row.line}-${index}`} className="border-t border-terminal-border"><td className="p-2 align-top text-terminal-muted">{row.line}</td><td className="max-w-48 break-all p-2 align-top font-mono text-terminal-text">{row.symbol || "(empty)"}</td><td className="p-2 text-terminal-muted"><strong className={`block font-medium ${row.status === "invalid" ? "text-terminal-neg" : "text-terminal-text"}`}>{statusLabels[row.status]}</strong><span className="mt-1 block text-[11px] leading-4">{row.reason}</span></td></tr>)}</tbody></table>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-terminal-muted">Only rows marked “Ready to add” will be imported. Other rows are skipped.</p>
            <TerminalButton size="sm" variant="accent" className="mt-2" disabled={disabled || !preview.symbols.length} loading={mutation.isPending} onClick={confirmImport}>Import reviewed symbols ({preview.symbols.length})</TerminalButton>
          </> : !success && <div className="rounded border border-dashed border-terminal-border p-5 text-xs leading-6 text-terminal-muted"><h3 className="font-medium text-terminal-text">Your review will appear here</h3><p>Nothing is added until you review the rows and select Import reviewed symbols. Bare symbols stay bare; this importer does not assign an exchange.</p></div>}
          {(fileError || preview?.error) && <p role="alert" className="mt-3 text-xs leading-5 text-terminal-neg">{fileError || preview?.error}</p>}
          {mutation.isError && <p role="alert" className="mt-3 text-xs leading-5 text-terminal-neg">Import failed: {extractApiErrorMessage(mutation.error, "The server could not add these symbols.")} Your review is retained. Retry after checking the connection.</p>}
          {success && <p role="status" className="rounded border border-terminal-border p-4 text-sm text-terminal-pos">{success}</p>}
        </div>
      </div>
    </section>
  );
}
