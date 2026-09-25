import { useEffect, useState } from "react";
import { fetchSecurityConviction, type ConvictionResponse } from "../../api/conviction";
import { GuidedEmptyState } from "./GuidedEmptyState";

function asPct(value: unknown): number | null {
  const next = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(next)) return null;
  return Math.max(0, Math.min(100, Math.abs(next) <= 1 ? next * 100 : next));
}

function formatDate(value?: string): string {
  if (!value) return "Date TBA";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CatalystConvictionPanel({
  symbol,
  market,
  onOpenScreener,
}: {
  symbol: string;
  market?: string;
  onOpenScreener?: () => void;
}) {
  const [data, setData] = useState<ConvictionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    setEmpty(false);
    fetchSecurityConviction(symbol)
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setEmpty(payload == null);
      })
      .catch(() => {
        if (active) {
          setData(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [symbol]);
  const bullish = asPct(data?.bullish_score ?? data?.conviction_score);
  const bearish = asPct(data?.bearish_score);
  const label =
    data?.label ||
    (bullish != null && bearish != null ? (bullish > bearish + 5 ? "Bullish" : bearish > bullish + 5 ? "Bearish" : "Neutral") : "Pending");
  const catalysts = (data?.upcoming_catalysts || data?.catalysts || []).slice(0, 5);

  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg/70 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">AI Catalyst Conviction</h3>
          <p className="mt-1 text-xs text-terminal-muted">{symbol} / {market || data?.market || "GLOBAL"} stock-picking catalyst score.</p>
        </div>
        <span className={`rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
          String(label).toLowerCase().includes("bear")
            ? "border-terminal-neg/50 text-terminal-neg"
            : String(label).toLowerCase().includes("bull")
              ? "border-terminal-pos/50 text-terminal-pos"
              : "border-terminal-border text-terminal-muted"
        }`}>
          {label}
        </span>
      </div>

      {empty ? (
        <GuidedEmptyState
          title="No conviction record yet"
          message="No catalyst notes have been ingested for this symbol. Ingest catalyst notes or open the screener to build a stock-picking candidate set."
          icon="AI"
          actions={onOpenScreener ? [{ label: "Open Screener", onClick: onOpenScreener }] : []}
        />
      ) : failed ? (
        <GuidedEmptyState
          title="Conviction feed unavailable"
          message="Ingest catalyst notes for this symbol or open the screener to build a fresh stock-picking candidate set."
          icon="AI"
          actions={onOpenScreener ? [{ label: "Open Screener", onClick: onOpenScreener }] : []}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-terminal-muted">
                <span>Bullish</span>
                <span>{bullish == null ? "--" : `${bullish.toFixed(0)}%`}</span>
              </div>
              <div className="h-2 rounded bg-terminal-panel">
                <div className="h-2 rounded bg-terminal-pos/70" style={{ width: `${bullish ?? 0}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-terminal-muted">
                <span>Bearish</span>
                <span>{bearish == null ? "--" : `${bearish.toFixed(0)}%`}</span>
              </div>
              <div className="h-2 rounded bg-terminal-panel">
                <div className="h-2 rounded bg-terminal-neg/70" style={{ width: `${bearish ?? 0}%` }} />
              </div>
            </div>
            <p className="text-xs text-terminal-muted">{data?.summary || (loading ? "Loading catalyst read..." : "No written conviction summary has been ingested yet.")}</p>
          </div>

          <div className="space-y-2">
            {catalysts.length ? (
              catalysts.map((catalyst, index) => (
                <div key={`${catalyst.title || "catalyst"}-${index}`} className="rounded-sm border border-terminal-border bg-terminal-panel/70 px-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] uppercase text-terminal-accent">{formatDate(catalyst.date || catalyst.expected_date)}</span>
                    {catalyst.impact ? <span className="text-[11px] uppercase text-terminal-muted">{catalyst.impact}</span> : null}
                  </div>
                  <div className="mt-1 text-sm text-terminal-text">{catalyst.title || catalyst.description || "Upcoming catalyst"}</div>
                  {catalyst.source ? <div className="mt-1 text-[11px] text-terminal-muted">{catalyst.source}</div> : null}
                </div>
              ))
            ) : (
              <GuidedEmptyState
                title="No catalysts queued"
                message="Ingest catalyst research to show dated upside and downside drivers for this security."
                icon="CAT"
                actions={onOpenScreener ? [{ label: "Open Screener", onClick: onOpenScreener }] : []}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
