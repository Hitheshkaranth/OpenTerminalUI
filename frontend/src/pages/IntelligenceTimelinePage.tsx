import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { IntelligenceTimeline } from "../components/dashboard/IntelligenceTimeline";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import { normalizeTicker } from "../utils/ticker";
import {
  fetchIdeasTimeline,
  marketFromDesk,
  type TimelineEvent,
  type Market,
} from "../api/ideasThemes";
import { fetchIntelligenceTimeline, type IntelligenceTimelineItem } from "../api/intelligence";

const LIMIT = 40;

function toIdeaKind(kind: TimelineEvent["kind"]): IntelligenceTimelineItem["kind"] {
  switch (kind) {
    case "insider":
      return "insider";
    case "results":
      return "earnings";
    case "analysis":
      return "model_signal";
    default:
      return "event";
  }
}

function toTimelineItem(event: TimelineEvent, index: number): IntelligenceTimelineItem {
  const symbol = String(event.symbol || "").toUpperCase();
  return {
    id: `idea-${event.kind}-${symbol}-${index}-${String(event.headline).slice(0, 40)}`,
    kind: toIdeaKind(event.kind),
    title: event.headline || (symbol ? `Idea — ${symbol}` : "Idea"),
    symbol: symbol || undefined,
    source: "Ideas",
    timestamp: event.date || undefined,
    url: event.source_url || undefined,
  };
}

function sortItems(items: IntelligenceTimelineItem[]): IntelligenceTimelineItem[] {
  return items
    .concat()
    .sort((left, right) => {
      const leftTs = left.timestamp ? Date.parse(`${left.timestamp}T00:00:00Z`) : 0;
      const rightTs = right.timestamp ? Date.parse(`${right.timestamp}T00:00:00Z`) : 0;
      return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
    });
}

export function IntelligenceTimelinePage() {
  const navigate = useNavigate();
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const storeTicker = useStockStore((state) => state.ticker);
  const [draft, setDraft] = useState(storeTicker || "AAPL");
  const [symbol, setSymbol] = useState(normalizeTicker(storeTicker || "AAPL"));
  const symbols = useMemo(() => [symbol].filter(Boolean), [symbol]);

  const market: Market = useMemo(() => marketFromDesk(selectedMarket), [selectedMarket]);
  const [merged, setMerged] = useState<IntelligenceTimelineItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setMerged(null);
    setLoading(true);

    void Promise.allSettled([
      fetchIntelligenceTimeline({ market, symbol, symbols, limit: LIMIT }),
      fetchIdeasTimeline({ symbols, market, limit: LIMIT }),
    ])
      .then((results) => {
        if (!active) return;
        const [baseResult, ideasResult] = results;
        const base: IntelligenceTimelineItem[] = baseResult.status === "fulfilled" ? baseResult.value : [];
        const ideaItems: IntelligenceTimelineItem[] =
          ideasResult.status === "fulfilled"
            ? ideasResult.value.map((event, index) => toTimelineItem(event, index))
            : [];
        setMerged(sortItems([...ideaItems, ...base]));
      })
      .catch(() => {
        if (!active) return;
        setMerged([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [market, symbol, symbols]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSymbol(normalizeTicker(draft));
  };

  return (
    <div className="h-full min-h-0 overflow-auto bg-terminal-bg p-3 font-mono md:p-4">
      <div className="mb-3 rounded-sm border border-terminal-border bg-terminal-panel/80 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="ot-type-panel-title uppercase tracking-[0.16em] text-terminal-accent">Intelligence</p>
            <h1 className="mt-1 text-xl font-semibold uppercase tracking-[0.12em] text-terminal-text">Unified Timeline</h1>
            <p className="mt-1 max-w-3xl text-sm text-terminal-muted">
              Market-aware US and India feed for news, alerts, corporate events, insider flow, earnings, model signals, ideas,
              and validated runs.
            </p>
          </div>
          <form className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]" onSubmit={onSubmit}>
            <TerminalInput value={draft} onChange={(event) => setDraft(event.target.value.toUpperCase())} placeholder="Ticker" />
            <TerminalButton type="submit" variant="accent">Load</TerminalButton>
            <TerminalButton type="button" onClick={() => navigate("/equity/alerts")}>Add Alert</TerminalButton>
          </form>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2 text-[11px] text-terminal-muted">
        {loading ? <span>Freshening…</span> : <span>Live · {market} desk · {symbol || "—"}</span>}
      </div>

      <IntelligenceTimeline
        market={market}
        symbol={symbol}
        symbols={symbols}
        limit={LIMIT}
        items={merged ?? undefined}
        onAddAlert={() => navigate("/equity/alerts")}
        onOpenScreener={() => navigate("/equity/screener")}
      />
    </div>
  );
}

export default IntelligenceTimelinePage;