import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { formatPct } from "../../utils/formatters";

type Props = {
  stock: {
    ticker: string;
    company_name?: string;
    sector?: string;
    industry?: string;
    current_price?: number;
    change_pct?: number;
    market_cap?: number;
    pe?: number;
    forward_pe_calc?: number;
    pb_calc?: number;
    ps_calc?: number;
    ev_ebitda?: number;
    roe_pct?: number;
    roa_pct?: number;
    op_margin_pct?: number;
    net_margin_pct?: number;
    rev_growth_pct?: number;
    eps_growth_pct?: number;
    div_yield_pct?: number;
    beta?: number;
  };
  momPct?: number | null;
  qoqPct?: number | null;
  yoyPct?: number | null;
};

const METRICS: Array<[string, keyof Props["stock"], "money" | "compact" | "pct" | "raw"]> = [
  ["Market Cap", "market_cap", "compact"],
  ["P/E (TTM)", "pe", "raw"],
  ["P/E (Fwd)", "forward_pe_calc", "raw"],
  ["P/B", "pb_calc", "raw"],
  ["P/S", "ps_calc", "raw"],
  ["EV/EBITDA", "ev_ebitda", "raw"],
  ["ROE", "roe_pct", "pct"],
  ["ROA", "roa_pct", "pct"],
  ["Op Margin", "op_margin_pct", "pct"],
  ["Net Margin", "net_margin_pct", "pct"],
  ["Revenue Growth", "rev_growth_pct", "pct"],
  ["EPS Growth", "eps_growth_pct", "pct"],
  ["Dividend Yield", "div_yield_pct", "pct"],
  ["Beta", "beta", "raw"],
];

function toNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function moveLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const direction = value >= 0 ? "Increase" : "Decrease";
  return `${direction} ${value >= 0 ? "+" : ""}${formatPct(value)}`;
}

function moveClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "text-terminal-muted";
  return value >= 0 ? "text-terminal-pos" : "text-terminal-neg";
}

export function OverviewPanel({ stock, momPct, qoqPct, yoyPct }: Props) {
  const { formatDisplayMoney, formatFinancialCompact } = useDisplayCurrency();
  const changePct = toNum(stock.change_pct);
  const priceMoveClass =
    changePct === undefined
      ? "text-terminal-muted"
      : changePct >= 0
      ? "text-terminal-pos"
      : "text-terminal-neg";
  const moveText =
    changePct === undefined
      ? "-"
      : `${changePct >= 0 ? "+" : ""}${formatPct(changePct)}`;
  const currentPrice = toNum(stock.current_price);

  return (
    <div className="space-y-3">
      <div className="rounded border border-terminal-border bg-terminal-panel p-4">
        <div className="text-xs text-terminal-muted">{stock.ticker} | NSE</div>
        <div className="text-xl font-semibold">{stock.company_name || stock.ticker}</div>
        <div className="mt-1 text-sm text-terminal-muted">
          {stock.sector || "-"} | {stock.industry || "-"}
        </div>
        <div className="mt-3 flex items-end gap-3">
          <div className="text-2xl font-bold tabular-nums">
            {currentPrice !== undefined ? formatDisplayMoney(currentPrice) : "-"}
          </div>
          <div className={`text-sm font-semibold ${priceMoveClass}`}>{moveText}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-xs text-terminal-muted">MoM Price Move</div>
          <div className={`mt-1 text-sm font-semibold ${moveClass(momPct)}`}>{moveLabel(momPct)}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-xs text-terminal-muted">QoQ Price Move</div>
          <div className={`mt-1 text-sm font-semibold ${moveClass(qoqPct)}`}>{moveLabel(qoqPct)}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-xs text-terminal-muted">YoY Price Move</div>
          <div className={`mt-1 text-sm font-semibold ${moveClass(yoyPct)}`}>{moveLabel(yoyPct)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map(([label, key, mode]) => {
          const val = toNum(stock[key]);
          const rendered =
            mode === "compact"
              ? val !== undefined
                ? formatFinancialCompact(val)
                : "-"
              : mode === "money"
              ? val !== undefined
                ? formatDisplayMoney(val)
                : "-"
              : mode === "pct"
              ? formatPct(val)
              : val?.toFixed(2) ?? "-";
          return (
            <div key={label} className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">{label}</div>
              <div className={`mt-1 text-sm font-semibold ${mode === "money" || mode === "compact" ? "tabular-nums" : ""}`}>{rendered}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
