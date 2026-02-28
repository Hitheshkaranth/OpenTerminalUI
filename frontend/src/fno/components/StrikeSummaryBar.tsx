import type { ChainSummary } from "../types/fno";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";

type Props = {
  symbol: string;
  expiry: string;
  spotPrice: number;
  summary?: ChainSummary;
};

export function StrikeSummaryBar({ symbol, expiry, spotPrice, summary }: Props) {
  const { formatDisplayMoney } = useDisplayCurrency();
  return (
    <div className="grid grid-cols-1 gap-2 rounded border border-terminal-border bg-terminal-panel p-3 md:grid-cols-8">
      <div>
        <div className="text-[10px] uppercase text-terminal-muted flex items-center gap-1">
          Symbol {summary?.market && <span className="bg-terminal-accent/20 text-terminal-accent px-1 rounded text-[8px]">{summary.market}</span>}
        </div>
        <div className="text-sm font-semibold">{symbol || "-"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">Expiry</div>
        <div className="text-sm font-semibold">{expiry || "-"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">Spot</div>
        <div className="text-sm font-semibold">{formatDisplayMoney(spotPrice)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">ATM IV</div>
        <div className="text-sm font-semibold">{summary ? `${Number(summary.atm_iv || 0).toFixed(2)}%` : "-"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">IV Rank</div>
        <div className="text-sm font-semibold text-terminal-accent">{summary?.iv_rank ? `${summary.iv_rank.toFixed(1)}%` : "0.0%"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">IV Pctl</div>
        <div className="text-sm font-semibold text-terminal-accent">{summary?.iv_percentile ? `${summary.iv_percentile.toFixed(1)}%` : "0.0%"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">PCR</div>
        <div className="text-sm font-semibold">{summary ? Number(summary.pcr?.pcr_oi || 0).toFixed(2) : "-"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">Max Pain</div>
        <div className="text-sm font-semibold">{typeof summary?.max_pain === "number" ? formatDisplayMoney(summary.max_pain) : "-"}</div>
      </div>
    </div>
  );
}
