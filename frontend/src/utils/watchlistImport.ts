export const MAX_WATCHLIST_IMPORT_BYTES = 64 * 1024;
export const MAX_WATCHLIST_IMPORT_ROWS = 500;
export const MAX_WATCHLIST_SYMBOL_LENGTH = 40;

export type WatchlistImportStatus = "ready" | "duplicate" | "existing" | "invalid";
export interface WatchlistImportRow {
  line: number;
  input: string;
  symbol: string;
  status: WatchlistImportStatus;
  reason: string;
}
export interface WatchlistImportPreview {
  rows: WatchlistImportRow[];
  symbols: string[];
  error: string | null;
}

function delimiterFor(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "," || char === ";" || char === "\t")) return char;
    if (!quoted && (char === "\r" || char === "\n")) break;
  }
  return ",";
}

function parseRecords(text: string): Array<{ line: number; cells: string[] }> {
  const delimiter = delimiterFor(text.trimStart());
  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let startLine = 1;
  const finishCell = () => { cells.push(cell.trim()); cell = ""; closedQuote = false; };
  const finishRecord = () => {
    finishCell();
    if (cells.some((value) => value.length)) records.push({ line: startLine, cells });
    cells = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else { quoted = false; closedQuote = true; }
      } else {
        cell += char;
        if (char === "\n") line += 1;
      }
      continue;
    }
    if (char === '"') {
      if (cell.trim() || closedQuote) throw new Error(`Unexpected quote at line ${line}. Use a valid CSV file.`);
      cell = ""; quoted = true;
    } else if (char === delimiter) finishCell();
    else if (char === "\n" || char === "\r") {
      finishRecord();
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      line += 1; startLine = line;
    } else {
      if (closedQuote && char.trim()) throw new Error(`Unexpected text after a quoted field at line ${line}.`);
      if (!closedQuote) cell += char;
    }
  }
  if (quoted) throw new Error("A quoted CSV field is unfinished. Close its quote before reviewing.");
  if (cell.length || cells.length || closedQuote) finishRecord();
  return records;
}

/** Syntax review only: this never looks up a listing or guesses an exchange. */
export function parseWatchlistImport(text: string, existingSymbols: readonly string[] = []): WatchlistImportPreview {
  const fail = (error: string): WatchlistImportPreview => ({ rows: [], symbols: [], error });
  if (new Blob([text]).size > MAX_WATCHLIST_IMPORT_BYTES) return fail("Use a TXT or CSV file no larger than 64 KiB.");
  let records: Array<{ line: number; cells: string[] }>;
  try { records = parseRecords(text.replace(/^\uFEFF/, "")); }
  catch (error) { return fail(error instanceof Error ? error.message : "Unable to read this CSV."); }
  if (!records.length) return fail("Paste at least one symbol or choose a TXT or CSV file.");
  const header = records[0].cells.map((value) => value.toLowerCase());
  const symbolColumns = header.flatMap((value, index) => /^(symbol|ticker)$/.test(value) ? [index] : []);
  if (symbolColumns.length > 1) return fail("Use exactly one symbol or ticker column in the CSV header.");
  const hasHeader = symbolColumns.length === 1;
  const symbolColumn = hasHeader ? symbolColumns[0] : 0;
  const exchangeColumn = hasHeader ? header.indexOf("exchange") : -1;
  if (hasHeader) records = records.slice(1);
  if (!records.length) return fail("The header has no symbols beneath it.");
  if (!hasHeader && records.some((record) => record.cells.length > 1)) {
    // TradingView's documented TXT export is comma-separated and exchange-prefixed.
    // Recognize it only when every nonempty token is qualified or an explicit section label.
    // Arbitrary headerless CSV remains ambiguous and must not be treated as a symbol list.
    const nativeTxt = records.every((record) => record.cells.every((value) =>
      !value || /^[A-Z][A-Z0-9]*:(?:[A-Z0-9]|\^[A-Z0-9])[A-Z0-9._=&\-]*$/i.test(value) || value.startsWith("###"),
    ));
    if (!nativeTxt) return fail("For multiple columns, include a symbol or ticker header. Otherwise put one symbol on each line. Comma-separated TXT requires an explicit exchange prefix on every symbol.");
    records = records.flatMap((record) => record.cells.map((cell) => ({ line: record.line, cells: [cell] })));
  }
  if (records.length > MAX_WATCHLIST_IMPORT_ROWS) return fail("Import no more than 500 nonempty rows or comma-separated TXT entries at a time.");
  const existing = new Set(existingSymbols.map((symbol) => symbol.trim().toUpperCase()));
  const seen = new Set<string>();
  const rows = records.map(({ line, cells }): WatchlistImportRow => {
    const input = cells[symbolColumn] || "";
    let symbol = input.toUpperCase().trim();
    const exchange = exchangeColumn >= 0 ? (cells[exchangeColumn] || "").toUpperCase().trim() : "";
    const row = (status: WatchlistImportStatus, reason: string) => ({ line, input, symbol, status, reason });
    if (symbol.startsWith("###")) return row("invalid", "Section label, not a symbol; it will be skipped.");
    if (symbol.length > MAX_WATCHLIST_SYMBOL_LENGTH || !/^(?:[A-Z][A-Z0-9]*:)?(?:[A-Z0-9]|\^[A-Z0-9])[A-Z0-9._=&\-]*$/.test(symbol)) {
      return row("invalid", "Use 1–40 symbol characters without spaces or formula syntax.");
    }
    if (exchange) {
      if (!["NSE", "BSE", "NYSE", "NASDAQ"].includes(exchange)) return row("invalid", "Exchange must be NSE, BSE, NYSE, or NASDAQ; other qualified symbols can be provided directly.");
      if (symbol.includes(":")) {
        if (symbol.split(":")[0] !== exchange) return row("invalid", "The exchange column conflicts with the qualified symbol.");
      } else if (/\.(NS|BO)$/.test(symbol)) {
        const suffixExchange = symbol.endsWith(".NS") ? "NSE" : "BSE";
        if (suffixExchange !== exchange) return row("invalid", "The exchange column conflicts with the symbol suffix.");
      } else symbol = `${exchange}:${symbol}`;
    }
    if (symbol.length > MAX_WATCHLIST_SYMBOL_LENGTH) return row("invalid", "Qualified symbols must be no longer than 40 characters.");
    if (seen.has(symbol)) return row("duplicate", "Repeated in this import.");
    seen.add(symbol);
    if (existing.has(symbol)) return row("existing", "Already in this watchlist.");
    return row("ready", "Syntax accepted; listing and market coverage are not verified.");
  });
  return { rows, symbols: rows.filter((row) => row.status === "ready").map((row) => row.symbol), error: null };
}
