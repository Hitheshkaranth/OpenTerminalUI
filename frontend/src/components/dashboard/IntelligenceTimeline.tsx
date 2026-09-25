import { useEffect, useMemo, useState } from "react";
import { fetchIntelligenceTimeline, type IntelligenceTimelineItem } from "../../api/intelligence";
import { GuidedEmptyState } from "./GuidedEmptyState";

function formatTime(value?: string): string {
  if (!value) return "Pending";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function kindLabel(kind: IntelligenceTimelineItem["kind"]): string {
  return kind.replace("_", " ").toUpperCase();
}

function toneClass(item: IntelligenceTimelineItem): string {
  const label = `${item.sentiment || ""}`.toLowerCase();
  if (label.includes("bear") || label.includes("sell") || label.includes("negative")) return "border-terminal-neg/50 text-terminal-neg";
  if (label.includes("bull") || label.includes("buy") || label.includes("positive")) return "border-terminal-pos/50 text-terminal-pos";
  if (item.kind === "alert" || item.kind === "corporate_action") return "border-terminal-warn/50 text-terminal-warn";
  return "border-terminal-accent/50 text-terminal-accent";
}

export function IntelligenceTimeline({
  market,
  symbol,
  symbols,
  limit = 18,
  title = "Unified Intelligence Timeline",
  items,
  onAddAlert,
  onOpenScreener,
}: {
  market?: string;
  symbol?: string;
  symbols?: string[];
  limit?: number;
  title?: string;
  items?: IntelligenceTimelineItem[];
  onAddAlert?: () => void;
  onOpenScreener?: () => void;
}) {
  const [fetchedItems, setFetchedItems] = useState<IntelligenceTimelineItem[]>([]);
  const [fetching, setFetching] = useState(false);
  const symbolKey = useMemo(() => (symbols ?? []).join(","), [symbols]);

  useEffect(() => {
    if (items) return;
    let active = true;
    setFetching(true);
    fetchIntelligenceTimeline({ market, symbol, symbols, limit })
      .then((data) => {
        if (active) setFetchedItems(data);
      })
      .catch(() => {
        if (active) setFetchedItems([]);
      })
      .finally(() => {
        if (active) setFetching(false);
      });
    return () => {
      active = false;
    };
  }, [items, limit, market, symbol, symbolKey]);

  const rows = items ?? fetchedItems;

  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">{title}</h3>
          <p className="mt-1 text-xs text-terminal-muted">
            News, alerts, events, insider activity, earnings, corporate actions, model signals, and backtest runs.
          </p>
        </div>
        {fetching ? <span className="text-[11px] uppercase tracking-[0.12em] text-terminal-muted">Syncing...</span> : null}
      </div>
      {rows.length ? (
        <ol className="space-y-2" role="list">
          {rows.slice(0, limit).map((item) => {
            const content = (
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${toneClass(item)}`}>
                    {kindLabel(item.kind)}
                  </span>
                  {item.symbol ? <span className="text-[11px] uppercase text-terminal-accent">{item.symbol}</span> : null}
                  <span className="text-[11px] text-terminal-muted">{formatTime(item.timestamp)}</span>
                  {item.source ? <span className="text-[11px] text-terminal-muted">/ {item.source}</span> : null}
                </div>
                <div className="text-sm text-terminal-text">{item.title}</div>
              </div>
            );
            return (
              <li key={item.id} className="relative rounded-sm border border-terminal-border bg-terminal-bg/60 px-3 py-2">
                {item.url && /^https?:\/\//i.test(item.url) ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="block hover:text-terminal-accent">
                    {content}
                  </a>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <GuidedEmptyState
          title="No timeline events"
          message="Add a watchlist, create an alert, or run a model preset to seed the unified desk timeline."
          icon="TL"
          actions={[
            { label: "Add Alert", onClick: onAddAlert },
            { label: "Open Screener", onClick: onOpenScreener },
          ].filter((action) => Boolean(action.onClick))}
        />
      )}
    </div>
  );
}
