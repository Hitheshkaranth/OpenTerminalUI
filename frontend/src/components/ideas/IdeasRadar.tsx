import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import {
  fetchIdeasBoard,
  type IdeaCategory,
  type IdeaItem,
  type IdeasBoard,
  type Market,
} from "../../api/ideasThemes";

const MAX_CATEGORIES = 4;
const ITEMS_PER_CATEGORY = 2;

type RadarEntry = {
  categoryLabel: string;
  item: IdeaItem;
};

function fmtMetric(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(date: string | null): string {
  if (!date) return "";
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildEntries(board: IdeasBoard | null): RadarEntry[] {
  if (!board || !Array.isArray(board.categories)) return [];
  const entries: RadarEntry[] = [];
  board.categories
    .filter((category: IdeaCategory) => category.items && category.items.length > 0)
    .slice(0, MAX_CATEGORIES)
    .forEach((category: IdeaCategory) => {
      category.items.slice(0, ITEMS_PER_CATEGORY).forEach((item: IdeaItem) => {
        entries.push({ categoryLabel: category.label, item });
      });
    });
  return entries;
}

export function IdeaEntry({ categoryLabel, item }: RadarEntry) {
  return (
    <li className="group flex flex-col gap-1 border-b border-terminal-border/40 px-3 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-terminal-muted">{categoryLabel}</span>
        {item.date ? <span className="text-[10px] text-terminal-muted">{fmtDate(item.date)}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        {item.symbol ? (
          <a
            href={`/equity/security/${encodeURIComponent(item.symbol)}`}
            className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-terminal-accent hover:underline focus-visible:outline-none"
          >
            {item.symbol}
          </a>
        ) : null}
        <span className="min-w-0 truncate text-[12px] text-terminal-text">{item.headline}</span>
      </div>
      {item.metric_label && item.metric_value != null ? (
        <p className="pl-1 text-[11px] text-terminal-muted">
          {item.metric_label}: <span className="text-terminal-text">{fmtMetric(item.metric_value)}</span>
        </p>
      ) : null}
    </li>
  );
}

type Props = {
  market: Market;
};

export function IdeasRadar({ market }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ideas-radar", market],
    queryFn: () => fetchIdeasBoard(market),
  });
  const board: IdeasBoard | null = data ?? null;
  const entries = buildEntries(board);

  return (
    <section aria-label="Ideas radar" className="flex flex-col overflow-hidden rounded-sm border border-terminal-border bg-terminal-panel/80">
      <header className="flex items-start justify-between gap-2 border-b border-terminal-border px-3 py-2">
        <div>
          <h2 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">Ideas Radar</h2>
          <p className="mt-0.5 text-xs text-terminal-muted">Quick hits from the ideas board in the {market} desk.</p>
        </div>
        <a
          href={`/equity/hotlists?view=ideas`}
          className="shrink-0 inline-flex items-center gap-1 rounded-sm border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
        >
          Open ideas <ExternalLink className="h-3 w-3" />
        </a>
      </header>

      <div className="mt-2 max-h-72 flex-1 overflow-auto">
        {isLoading ? (
          <div className="px-3 py-6 text-center text-xs text-terminal-muted animate-pulse">Scanning ideas…</div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-xs text-terminal-neg">Ideas radar unavailable.</div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-terminal-muted">No ideas right now — check the ideas board.</div>
        ) : (
          <ul className="divide-y divide-terminal-border/30">
            {entries.map(({ categoryLabel, item }, index) => (
              <IdeaEntry key={`${item.symbol}-${categoryLabel}-${index}`} categoryLabel={categoryLabel} item={item} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default IdeasRadar;