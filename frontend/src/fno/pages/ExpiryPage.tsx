import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchExpiryDashboard, type ExpiryDashboardItem } from "../api/fnoApi";
import { formatMoney } from "../../lib/format";
import { useFnoContext } from "../FnoLayout";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import { TerminalBadge } from "../../components/terminal/TerminalBadge";

const NA = "—";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
// Max pain / S&R are strike prices in the underlying's own currency — never FX-converted.
const fmtStrike = (row: ExpiryDashboardItem, v: number | null | undefined) =>
  isNum(v) && v > 0 ? formatMoney(v, row.market === "US" ? "USD" : "INR") : NA;
const fmtIv = (v: number | null | undefined) => (isNum(v) && v > 0 ? `${v.toFixed(2)}%` : NA);
const fmtPcr = (v: number | null | undefined) => (isNum(v) ? v.toFixed(2) : NA);
const signalOf = (row: ExpiryDashboardItem) => row.pcr?.signal || "No data";
const signalVariant = (signal: string) => (signal === "Bullish" ? "success" : signal === "Bearish" ? "danger" : "neutral");

export function ExpiryPage() {
  const { symbol } = useFnoContext();

  const query = useQuery({
    queryKey: ["fno-expiry-dashboard"],
    queryFn: fetchExpiryDashboard,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const allItems = query.data ?? [];

  // Find the data for the currently selected symbol
  const selectedSymbolData = useMemo(() =>
    allItems.find(item => item.symbol.toUpperCase() === symbol.toUpperCase()),
    [allItems, symbol]
  );

  // Other active symbols for comparison
  const otherSymbols = useMemo(() =>
    allItems.filter(item => item.symbol.toUpperCase() !== symbol.toUpperCase()).slice(0, 10),
    [allItems, symbol]
  );

  return (
    <div className="space-y-4 font-mono">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main Selection Card */}
        <div className="lg:col-span-2">
          <TerminalPanel
            title={`EXPIRY ANALYSIS: ${symbol}`}
            subtitle={
              selectedSymbolData
                ? `Next Expiry: ${selectedSymbolData.expiry_date || NA}`
                : query.isLoading
                  ? "Loading index context..."
                  : "Not available for this symbol"
            }
          >
            {selectedSymbolData ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-2">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="text-[10px] text-terminal-muted uppercase">Days to Expiry</div>
                    <div className="text-2xl font-bold text-terminal-accent">
                      {isNum(selectedSymbolData.days_to_expiry) ? selectedSymbolData.days_to_expiry : NA} <span className="text-xs font-normal text-terminal-muted">DAYS REMAINING</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="text-[10px] text-terminal-muted uppercase">ATM IV</div>
                      <div className="text-lg font-bold text-terminal-info">
                        {fmtIv(selectedSymbolData.atm_iv)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-terminal-muted uppercase">Max Pain</div>
                      <div className="text-lg font-bold text-terminal-pos">
                        {fmtStrike(selectedSymbolData, selectedSymbolData.max_pain)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] text-terminal-muted uppercase">PCR (OI)</div>
                    <div className="flex items-center gap-2">
                      <div className="text-lg font-bold text-terminal-text">
                        {fmtPcr(selectedSymbolData.pcr?.pcr_oi)}
                      </div>
                      <TerminalBadge variant={signalVariant(signalOf(selectedSymbolData))}>
                        {signalOf(selectedSymbolData).toUpperCase()}
                      </TerminalBadge>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded border border-terminal-border/40 bg-terminal-bg p-3">
                    <div className="mb-2 text-[10px] font-bold text-terminal-muted uppercase tracking-wider border-b border-terminal-border/20 pb-1">Technical Levels</div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-[9px] text-terminal-pos uppercase mb-1">Support Zones</div>
                        <div className="flex flex-wrap gap-2">
                          {(selectedSymbolData.support_resistance?.support ?? []).map(val => (
                            <span key={val} className="rounded bg-terminal-pos/10 border border-terminal-pos/20 px-2 py-0.5 text-xs text-terminal-pos font-bold tabular-nums">
                              {fmtStrike(selectedSymbolData, val)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] text-terminal-neg uppercase mb-1">Resistance Zones</div>
                        <div className="flex flex-wrap gap-2">
                          {(selectedSymbolData.support_resistance?.resistance ?? []).map(val => (
                            <span key={val} className="rounded bg-terminal-neg/10 border border-terminal-neg/20 px-2 py-0.5 text-xs text-terminal-neg font-bold tabular-nums">
                              {fmtStrike(selectedSymbolData, val)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-xs text-terminal-muted italic">
                {query.isLoading
                  ? "Crunching expiry analytics..."
                  : `Expiry analytics are not available for ${symbol} — the dashboard tracks the NSE F&O universe listed below.`}
              </div>
            )}
          </TerminalPanel>
        </div>

        {/* Quick Stats / Legend */}
        <TerminalPanel title="EXPIRY CONTEXT" subtitle="Market-wide derivatives state">
          <div className="space-y-3 p-1 text-[11px]">
            <div className="rounded border border-terminal-border/30 p-2 bg-terminal-bg/50">
              <div className="text-terminal-accent font-bold mb-1 uppercase text-[10px]">What is Max Pain?</div>
              <div className="text-terminal-muted leading-relaxed">
                The strike price where the most options (in value) would expire worthless. Markets tend to gravitate here on expiry.
              </div>
            </div>
            <div className="rounded border border-terminal-border/30 p-2 bg-terminal-bg/50">
              <div className="text-terminal-accent font-bold mb-1 uppercase text-[10px]">PCR Interpretation</div>
              <div className="space-y-1">
                <div className="flex justify-between"><span>{">"} 1.0</span> <span className="text-terminal-pos font-bold text-[9px]">BULLISH / OVERBOUGHT</span></div>
                <div className="flex justify-between"><span>{"<"} 0.7</span> <span className="text-terminal-neg font-bold text-[9px]">BEARISH / OVERSOLD</span></div>
              </div>
            </div>
          </div>
        </TerminalPanel>
      </div>

      {/* Comparisons Table */}
      <TerminalPanel title="ACTIVE F&O UNIVERSE" subtitle="Comparative expiry metrics across tracked NSE symbols">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-terminal-border text-[10px] uppercase tracking-wider text-terminal-muted bg-terminal-panel">
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Next Expiry</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2 text-right">ATM IV</th>
                <th className="px-3 py-2 text-right">PCR (OI)</th>
                <th className="px-3 py-2 text-right">Max Pain</th>
                <th className="px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {otherSymbols.map((row) => (
                <tr key={`expiry-${row.symbol}`} className="border-b border-terminal-border/20 hover:bg-terminal-border/10 transition-colors">
                  <td className="px-3 py-2 font-bold text-terminal-accent">{row.symbol}</td>
                  <td className="px-3 py-2 text-terminal-dim">{row.expiry_date || NA}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{isNum(row.days_to_expiry) ? row.days_to_expiry : NA}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-terminal-info">{fmtIv(row.atm_iv)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPcr(row.pcr?.pcr_oi)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{fmtStrike(row, row.max_pain)}</td>
                  <td className="px-3 py-2 text-center">
                    <TerminalBadge variant={signalVariant(signalOf(row))} size="sm">
                      {signalOf(row).toUpperCase()}
                    </TerminalBadge>
                  </td>
                </tr>
              ))}
              {!otherSymbols.length && !query.isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-terminal-muted italic">
                    No comparative data available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
    </div>
  );
}
