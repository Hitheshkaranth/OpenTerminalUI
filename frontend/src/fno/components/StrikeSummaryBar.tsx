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
        {/* atm_iv is in percent points (14.25 = 14.25%) for both NSE and US chains */}
        <div className="text-sm font-semibold">{typeof summary?.atm_iv === "number" && summary.atm_iv > 0 ? `${summary.atm_iv.toFixed(2)}%` : "-"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">IV Rank</div>
        <div className="text-sm font-semibold text-terminal-accent">{typeof summary?.iv_rank === "number" ? `${summary.iv_rank.toFixed(1)}%` : "-"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">IV Pctl</div>
        <div className="text-sm font-semibold text-terminal-accent">{typeof summary?.iv_percentile === "number" ? `${summary.iv_percentile.toFixed(1)}%` : "-"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">PCR</div>
        <div className="text-sm font-semibold">{typeof summary?.pcr?.pcr_oi === "number" ? summary.pcr.pcr_oi.toFixed(2) : "-"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-terminal-muted">Max Pain</div>
        <div className="text-sm font-semibold">{typeof summary?.max_pain === "number" && summary.max_pain > 0 ? formatDisplayMoney(summary.max_pain) : "-"}</div>
      </div>
    </div>
  );
}
