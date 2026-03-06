import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { useMarketStatus } from "../../hooks/useStocks";
import { useQuotesStore, useQuotesStream } from "../../realtime/useQuotesStream";
import { useSettingsStore } from "../../store/settingsStore";
import { MissionControlPanel } from "./MissionControlPanel";

type MarketCell = {
  key: string;
  label: string;
  token: string;
};

const MARKET_CELLS: MarketCell[] = [
  { key: "nifty", label: "NIFTY 50", token: "NIFTY" },
  { key: "banknifty", label: "BANK NIFTY", token: "BANKNIFTY" },
  { key: "vix", label: "INDIA VIX", token: "INDIAVIX" },
];

function formatNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pctClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "text-terminal-muted";
  return value >= 0 ? "text-terminal-pos" : "text-terminal-neg";
}

export function MissionControlGrid() {
  const navigate = useNavigate();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const { data: marketStatus } = useMarketStatus();
  const { subscribe, unsubscribe } = useQuotesStream(selectedMarket);
  const ticksByToken = useQuotesStore((s) => s.ticksByToken);

  useEffect(() => {
    const tokens = MARKET_CELLS.map((cell) => cell.token);
    subscribe(tokens);
    return () => unsubscribe(tokens);
  }, [subscribe, unsubscribe]);

  const marketRows = useMemo(
    () =>
      MARKET_CELLS.map((cell) => {
        const streamKey = `${selectedMarket.toUpperCase()}:${cell.token}`;
        const tick = ticksByToken[streamKey];
        const ltp = Number.isFinite(Number(tick?.ltp)) ? Number(tick?.ltp) : null;
        const changePct = Number.isFinite(Number(tick?.change_pct)) ? Number(tick?.change_pct) : null;
        return { ...cell, ltp, changePct };
      }),
    [selectedMarket, ticksByToken],
  );

  const marketState = String(
    (marketStatus as { marketState?: Array<{ marketStatus?: string }> } | undefined)?.marketState?.[0]?.marketStatus ??
      "unknown",
  ).toUpperCase();
  const marketOpen = marketState === "OPEN";

  return (
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
      <MissionControlPanel title="Market Pulse" accent={marketOpen ? "pos" : "neg"}>
        <div className="space-y-2">
          {marketRows.map((row) => (
            <div key={row.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-sm border border-terminal-border/80 px-2 py-1.5">
              <span className="ot-type-label text-terminal-text">{row.label}</span>
              <span className="ot-type-data text-terminal-text">{formatNum(row.ltp)}</span>
              <span className={`ot-type-data ${pctClass(row.changePct)}`}>
                {row.changePct == null ? "--" : `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%`}
              </span>
            </div>
          ))}
        </div>
      </MissionControlPanel>

      <MissionControlPanel title="Launch Matrix">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="rounded-sm border border-terminal-border px-2 py-2 text-xs text-terminal-text hover:border-terminal-accent" onClick={() => navigate("/equity/stocks")}>
            Equity Market
          </button>
          <button type="button" className="rounded-sm border border-terminal-border px-2 py-2 text-xs text-terminal-text hover:border-terminal-accent" onClick={() => navigate("/equity/chart-workstation")}>
            Chart WS
          </button>
          <button type="button" className="rounded-sm border border-terminal-border px-2 py-2 text-xs text-terminal-text hover:border-terminal-accent" onClick={() => navigate("/equity/launchpad")}>
            Launchpad
          </button>
          <button type="button" className="rounded-sm border border-terminal-border px-2 py-2 text-xs text-terminal-text hover:border-terminal-accent" onClick={() => navigate("/equity/crypto")}>
            Crypto
          </button>
          <button type="button" className="rounded-sm border border-terminal-border px-2 py-2 text-xs text-terminal-text hover:border-terminal-accent" onClick={() => navigate("/equity/portfolio")}>
            Portfolio
          </button>
          <button type="button" className="rounded-sm border border-terminal-border px-2 py-2 text-xs text-terminal-text hover:border-terminal-accent" onClick={() => navigate("/backtesting")}>
            Backtesting
          </button>
        </div>
      </MissionControlPanel>

      <MissionControlPanel title="System Snapshot">
        <div className="space-y-2 text-xs">
          <div className="rounded-sm border border-terminal-border/80 px-2 py-1.5">
            <span className="text-terminal-muted">Data Mode</span>
            <span className="ml-2 text-terminal-text">{selectedMarket.toUpperCase()} stream relay</span>
          </div>
          <div className="rounded-sm border border-terminal-border/80 px-2 py-1.5">
            <span className="text-terminal-muted">Market State</span>
            <span className={`ml-2 ${marketOpen ? "text-terminal-pos" : "text-terminal-neg"}`}>{marketState}</span>
          </div>
          <div className="rounded-sm border border-terminal-border/80 px-2 py-1.5">
            <span className="text-terminal-muted">Keyboard</span>
            <span className="ml-2 text-terminal-text">Ctrl/Cmd+K palette, arrows + enter in rail</span>
          </div>
        </div>
      </MissionControlPanel>
    </div>
  );
}
