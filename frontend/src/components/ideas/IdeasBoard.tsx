import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { fetchIdeasBoard, type IdeaItem, type IdeasBoard, type Market } from "../../api/ideasThemes";

const MAX_ITEMS_PER_CATEGORY = 6;

function formatMetric(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatIdeaDate(date: string | null): string {
  if (!date) return "—";
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function IdeaItemCell({ item }: { item: IdeaItem }) {
  return (
    <li className="group flex flex-col gap-1 border-b border-terminal-border/40 px-3 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {item.symbol ? (
            <a
              href={`/equity/security/${encodeURIComponent(item.symbol)}`}
              className="shrink-0 rounded border border-terminal-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-terminal-accent hover:border-terminal-accent"
            >
              {item.symbol}
            </a>
          ) : null}
          <span className="min-w-0 truncate text-[12px] text-terminal-text">{item.headline}</span>
        </div>
        {item.source_url ? (
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            aria-label={item.headline || "Open source"}
            className="shrink-0 opacity-60 transition hover:opacity-100 group-hover:opacity-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-1 text-[11px]">
        {item.metric_label && item.metric_value != null ? (
          <span className="text-terminal-muted">
            {item.metric_label}: <span className="text-terminal-text">{formatMetric(item.metric_value)}</span>
          </span>
        ) : null}
        {item.date ? <span className="text-terminal-muted">/ {formatIdeaDate(item.date)}</span> : null}
      </div>
    </li>
  );
}

type Props = {
  market: Market;
};

export function IdeasBoard({ market }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ideas", market],
    queryFn: () => fetchIdeasBoard(market),
    refetchInterval: 60_000,
  });
  const board: IdeasBoard | null = data ?? null;
  const categories = board ? board.categories : [];
  const anyWarnings = board ? board.warnings.filter(Boolean) : [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-terminal-border bg-terminal-panel/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-terminal-border px-3 py-2">
        <div>
          <h2 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">Ideas Board</h2>
          <p className="mt-0.5 text-xs text-terminal-muted">
            {board
              ? `Generated ${new Date(board.generated_at).toLocaleString("en-US")}`
              : isLoading
                ? "Loading ideas…"
                : `Desk ideas · ${market}`}
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-terminal-muted">
          <span className={market === "IN" ? "text-terminal-accent" : ""}>{market === "IN" ? "IN" : "US"}</span>
          <span className="opacity-40">|</span>
          <span className={market === "US" ? "text-terminal-accent" : ""}>US</span>
        </div>
      </div>

      {anyWarnings.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-terminal-warn/40 bg-terminal-warn/10 px-3 py-2 text-xs text-terminal-warn">
          {anyWarnings.map((warning, index) => (
            <span key={index} className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-[1px] bg-current opacity-80" />
              {warning}
            </span>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-xs text-terminal-muted animate-pulse">
            CALCULATING IDEAS…
          </div>
        ) : error ? (
          <div className="p-3">
            <div className="rounded border border-terminal-neg/40 bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">
              Unable to load the ideas board.
            </div>
            <button
              type="button"
              className="mt-2 rounded border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={() => void refetch()}
            >
              Retry
            </button>
          </div>
        ) : categories.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-terminal-muted">
            No ideas surfaced for the {market} desk right now. Check back after the next scan.
          </div>
        ) : (
          <div className="grid gap-3 p-3 lg:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => (
              <section
                key={category.id}
                aria-label={category.label}
                className="flex flex-col overflow-hidden rounded-sm border border-terminal-border bg-terminal-bg/40"
              >
                <header className="flex items-start justify-between gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-2">
                  <div className="min-w-0">
                    <span className="block text-[11px] uppercase tracking-[0.12em] text-terminal-accent">
                      {category.label}
                    </span>
                    {category.description ? (
                      <p className="mt-0.5 truncate text-[11px] text-terminal-muted">{category.description}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted">
                    {category.items.length}
                  </span>
                </header>
                <ul className="min-h-0 flex-1 divide-y divide-terminal-border/30">
                  {category.items.slice(0, MAX_ITEMS_PER_CATEGORY).map((item, index) => (
                    <IdeaItemCell key={`${item.symbol}-${category.id}-${index}`} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default IdeasBoard;