export type ImportRow = {
  ticker: string;
  quantity: number;
  avg_buy_price: number;
  buy_date: string | null;
  exchange: string | null;
};

export type CsvParseResult = {
  rows: ImportRow[];
  detectedFormat: "zerodha" | "groww" | "generic" | "unknown";
  errors: Array<{ line: number; reason: string }>;
  headers: string[];
};

/* ──────────────────────────── helpers ──────────────────────────── */

function stripNonAlphanum(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "");
}

function normHeader(s: string): string {
  return stripNonAlphanum(s).toLowerCase();
}

function trimCell(s: string): string {
  return s.trim();
}

function parseNumeric(s: string): number | null {
  const cleaned = s.replace(/[₹$,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(s: string): string | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;

  // YYYY-MM-DD
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }

  // DD-MM-YYYY
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(trimmed);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = parseInt(dmy[2], 10);
    const y = parseInt(dmy[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }

  // DD/MM/YYYY
  const dmy2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (dmy2) {
    const d = parseInt(dmy2[1], 10);
    const m = parseInt(dmy2[2], 10);
    const y = parseInt(dmy2[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }

  // Anything else → null
  return null;
}

function normalizeTicker(s: string): string {
  let t = s.toUpperCase().trim();
  // Strip surrounding quotes
  t = t.replace(/^["']+|["']+$/g, "");
  // Strip trailing -EQ, -BE, -NSE, -BO (Zerodha series suffix)
  t = t.replace(/-(EQ|BE|NSE|BO)$/, "");
  // Remove commas and periods (e.g., "ACME, Inc." → "ACME INC")
  t = t.replace(/[,.]/g, "");
  // Remove any remaining stray quotes (from escaped quotes like "")
  t = t.replace(/"/g, "");
  return t;
}

/* ──────────────────────── minimal RFC-4180 parser ──────────────── */

function parseCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];
    // skip leading CRLF / LF
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    if (i >= len) break;

    while (i < len) {
      // end of line
      if (text[i] === "\r" || text[i] === "\n") {
        i++; // consume \r\n or \n
        break;
      }

      let cell = "";
      if (text[i] === '"') {
        // quoted field
        i++; // consume opening "
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              cell += '"';
              i += 2;
            } else {
              i++; // consume closing "
              break;
            }
          } else {
            cell += text[i];
            i++;
          }
        }
        // skip comma after quoted field
        if (i < len && text[i] === ",") i++;
      } else {
        // unquoted field
        while (i < len && text[i] !== "," && text[i] !== "\r" && text[i] !== "\n") {
          cell += text[i];
          i++;
        }
        if (i < len && text[i] === ",") i++;
      }

      row.push(cell);
    }

    // skip blank rows
    const nonEmpty = row.some((c) => c.trim() !== "");
    if (nonEmpty) {
      rows.push(row);
    }
  }

  return rows;
}

/* ──────────────────── format detection ─────────────────────────── */

function detectFormat(headersRaw: string[]): "zerodha" | "groww" | "generic" | "unknown" {
  const norms = headersRaw.map(normHeader);

  // Zerodha: Instrument AND (Qty. or Qty) AND (Avg. cost or Avg cost)
  const hasInstrument = norms.some((n) => n === "instrument");
  const hasQty = norms.some((n) => n === "qty." || n === "qty");
  const hasAvgCost = norms.some((n) => n === "avgcost" || n === "avgcost");

  if (hasInstrument && hasQty && hasAvgCost) {
    return "zerodha";
  }

  // Groww: Stock Name AND Quantity AND (Average buy price or Avg Price)
  const hasStockName = norms.some((n) => n === "stockname");
  const hasQuantity = norms.some((n) => n === "quantity");
  const hasAvgPrice = norms.some((n) => n === "averagebuyprice" || n === "avgprice");

  if (hasStockName && hasQuantity && hasAvgPrice) {
    return "groww";
  }

  // Generic: needs a ticker-ish + qty + price column set
  const tickerCols = ["ticker", "symbol", "instrument", "scrip"];
  const qtyCols = ["quantity", "qty", "shares", "units"];
  const priceCols = ["avgbuyprice", "avgcost", "averageprice", "avgprice", "buyprice", "price"];
  const dateCols = ["buydate", "date", "purchasedate"];
  const exchangeCols = ["exchange"];

  const hasTicker = norms.some((n) => tickerCols.includes(n));
  const hasQtyCol = norms.some((n) => qtyCols.includes(n));
  const hasPriceCol = norms.some((n) => priceCols.includes(n));

  if (hasTicker && hasQtyCol && hasPriceCol) {
    return "generic";
  }

  return "unknown";
}

/* ────────────── column name mapping per format ─────────────────── */

function findCol(norms: string[], targets: string[]): number {
  for (const t of targets) {
    const idx = norms.indexOf(t);
    if (idx !== -1) return idx;
  }
  return -1;
}

function getCol(headers: string[], norms: string[], targets: string[]): string | undefined {
  const idx = findCol(norms, targets);
  if (idx === -1) return undefined;
  return headers[idx];
}

/* ──────────────────────────── parse ─────────────────────────────── */

export function parsePortfolioCsv(text: string): CsvParseResult {
  const lines = parseCsvLines(text);
  if (lines.length === 0) {
    return { rows: [], detectedFormat: "unknown", errors: [{ line: 1, reason: "Empty CSV" }], headers: [] };
  }

  const headersRaw = lines[0];
  const norms = headersRaw.map(normHeader);

  const format = detectFormat(headersRaw);

  if (format === "unknown") {
    return {
      rows: [],
      detectedFormat: "unknown",
      errors: [{ line: 1, reason: `Unrecognised columns: ${headersRaw.map((h) => `"${h}"`).join(", ")}` }],
      headers: headersRaw.map((h) => h.trim()),
    };
  }

  const errors: Array<{ line: number; reason: string }> = [];
  const rows: ImportRow[] = [];

  if (format === "zerodha") {
    const tickerCol = getCol(headersRaw, norms, ["instrument"]);
    const qtyCol = getCol(headersRaw, norms, ["qty.", "qty"]);
    const avgCol = getCol(headersRaw, norms, ["avgcost", "avgcost"]);

    if (!tickerCol || !qtyCol || !avgCol) {
      errors.push({ line: 1, reason: "Missing required columns for Zerodha format" });
      return { rows: [], detectedFormat: "zerodha", errors, headers: headersRaw.map((h) => h.trim()) };
    }

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i];
      const ticker = normalizeTicker(cells[findCol(norms, ["instrument"])] ?? "");
      const qtyRaw = cells[findCol(norms, ["qty.", "qty"])] ?? "";
      const avgRaw = cells[findCol(norms, ["avgcost", "avgcost"])] ?? "";
      const ltpCell = cells[findCol(norms, ["ltp"])] ?? "";

      const qty = parseNumeric(qtyRaw);
      const avg = parseNumeric(avgRaw);

      if (!ticker) {
        errors.push({ line: i + 1, reason: "Empty ticker" });
        continue;
      }
      if (qty == null || qty <= 0) {
        errors.push({ line: i + 1, reason: `Invalid quantity: ${qtyRaw}` });
        continue;
      }
      if (avg == null || avg <= 0) {
        errors.push({ line: i + 1, reason: `Invalid avg cost: ${avgRaw}` });
        continue;
      }

      rows.push({ ticker, quantity: qty, avg_buy_price: avg, buy_date: null, exchange: null });
    }
  }

  if (format === "groww") {
    const hasSymbol = norms.some((n) => n === "symbol");
    const tickerColIdx = hasSymbol ? findCol(norms, ["symbol"]) : findCol(norms, ["stockname"]);
    const qtyColIdx = findCol(norms, ["quantity"]);
    const avgColIdx = findCol(norms, ["averagebuyprice", "avgprice"]);

    if (tickerColIdx === -1 || qtyColIdx === -1 || avgColIdx === -1) {
      errors.push({ line: 1, reason: "Missing required columns for Groww format" });
      return { rows: [], detectedFormat: "groww", errors, headers: headersRaw.map((h) => h.trim()) };
    }

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i];
      const ticker = normalizeTicker(cells[tickerColIdx] ?? "");
      const qty = parseNumeric(cells[qtyColIdx] ?? "");
      const avg = parseNumeric(cells[avgColIdx] ?? "");

      if (!ticker) {
        errors.push({ line: i + 1, reason: "Empty ticker" });
        continue;
      }
      // Groww exports without a Symbol column only carry the company name
      // ("Reliance Industries"), which is not a tradable ticker. Refuse the row
      // rather than importing a garbage symbol.
      if (/\s/.test(ticker)) {
        errors.push({
          line: i + 1,
          reason: `"${cells[tickerColIdx]}" is a company name, not a ticker — add a Symbol column or use a generic CSV`,
        });
        continue;
      }
      if (qty == null || qty <= 0) {
        errors.push({ line: i + 1, reason: `Invalid quantity: ${cells[qtyColIdx]}` });
        continue;
      }
      if (avg == null || avg <= 0) {
        errors.push({ line: i + 1, reason: `Invalid avg price: ${cells[avgColIdx]}` });
        continue;
      }

      rows.push({ ticker, quantity: qty, avg_buy_price: avg, buy_date: null, exchange: null });
    }
  }

  if (format === "generic") {
    const tickerIdx = findCol(norms, ["ticker", "symbol", "instrument", "scrip"]);
    const qtyIdx = findCol(norms, ["quantity", "qty", "shares", "units"]);
    const priceIdx = findCol(norms, ["avgbuyprice", "avgcost", "averageprice", "avgprice", "buyprice", "price"]);
    const dateIdx = findCol(norms, ["buydate", "date", "purchasedate"]);
    const exchangeIdx = findCol(norms, ["exchange"]);

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i];
      const ticker = normalizeTicker(cells[tickerIdx] ?? "");
      const qty = parseNumeric(cells[qtyIdx] ?? "");
      const avg = parseNumeric(cells[priceIdx] ?? "");
      const date = parseDate(cells[dateIdx] ?? "");
      const exchange = exchangeIdx !== -1 ? (cells[exchangeIdx] ?? null) : null;

      if (!ticker) {
        errors.push({ line: i + 1, reason: "Empty ticker" });
        continue;
      }
      if (qty == null || qty <= 0) {
        errors.push({ line: i + 1, reason: `Invalid quantity: ${cells[qtyIdx]}` });
        continue;
      }
      if (avg == null || avg <= 0) {
        errors.push({ line: i + 1, reason: `Invalid price: ${cells[priceIdx]}` });
        continue;
      }

      rows.push({ ticker, quantity: qty, avg_buy_price: avg, buy_date: date, exchange: exchange ? exchange.toUpperCase() : null });
    }
  }

  return { rows, detectedFormat: format, errors, headers: headersRaw.map((h) => h.trim()) };
}