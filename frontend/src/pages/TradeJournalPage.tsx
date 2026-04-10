import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  createJournalEntry,
  deleteJournalEntry,
  fetchJournalCalendar,
  fetchJournalEntries,
  fetchJournalEquityCurve,
  fetchJournalStats,
  updateJournalEntry,
  type JournalEntryPayload,
} from "../api/client";
import { JournalEntryForm } from "../components/journal/JournalEntryForm";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTabs } from "../components/terminal/TerminalTabs";
import type { JournalEntry } from "../types";

const tabs = [
  { id: "journal", label: "Journal" },
  { id: "analytics", label: "Analytics" },
  { id: "tags", label: "Tags" },
];

const emotionMeta: Record<string, string> = {
  confident: "😎",
  fearful: "😬",
  greedy: "🤑",
  neutral: "😐",
};

function formatMoney(value: number | null | undefined): string {
  if (value == null) return "OPEN";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function formatPct(value: number | null | undefined): string {
  if (value == null) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function truncate(value: string | null | undefined, max = 120): string {
  const text = (value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function summarizeGroups(entries: JournalEntry[], key: "strategy" | "setup") {
  const buckets = new Map<string, { name: string; count: number; wins: number; closed: number }>();
  for (const entry of entries) {
    const name = entry[key];
    if (!name) continue;
    const bucket = buckets.get(name) ?? { name, count: 0, wins: 0, closed: 0 };
    bucket.count += 1;
    if (entry.pnl != null) {
      bucket.closed += 1;
      if (entry.pnl > 0) bucket.wins += 1;
    }
    buckets.set(name, bucket);
  }
  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      winRate: bucket.closed ? (bucket.wins / bucket.closed) * 100 : 0,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function TradeJournalPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("journal");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [emotionFilter, setEmotionFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tagTargetId, setTagTargetId] = useState("");
  const [newTag, setNewTag] = useState("");
  const [tagRenameDraft, setTagRenameDraft] = useState<Record<string, string>>({});

  const filters = useMemo(
    () => ({
      symbol: symbolFilter || undefined,
      strategy: strategyFilter || undefined,
      emotion: emotionFilter || undefined,
      start: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined,
      end: endDate ? new Date(`${endDate}T23:59:59`).toISOString() : undefined,
    }),
    [emotionFilter, endDate, startDate, strategyFilter, symbolFilter],
  );

  const entriesQuery = useQuery({
    queryKey: ["journal", "entries", filters],
    queryFn: () => fetchJournalEntries(filters),
  });
  const statsQuery = useQuery({
    queryKey: ["journal", "stats"],
    queryFn: fetchJournalStats,
  });
  const equityCurveQuery = useQuery({
    queryKey: ["journal", "equity-curve"],
    queryFn: fetchJournalEquityCurve,
  });
  const calendarQuery = useQuery({
    queryKey: ["journal", "calendar"],
    queryFn: fetchJournalCalendar,
  });

  const entries = entriesQuery.data ?? [];
  const stats = statsQuery.data;
  const strategies = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.strategy).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const setups = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.setup).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const tagSummary = useMemo(() => {
    const buckets = new Map<string, { tag: string; count: number }>();
    for (const entry of entries) {
      for (const tag of entry.tags || []) {
        const bucket = buckets.get(tag) ?? { tag, count: 0 };
        bucket.count += 1;
        buckets.set(tag, bucket);
      }
    }
    return Array.from(buckets.values()).sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
  }, [entries]);
  const calendarHeatmap = useMemo(() => {
    const map = new Map((calendarQuery.data ?? []).map((day) => [day.date, day]));
    const cells: Array<{ date: string; pnl: number; tradeCount: number }> = [];
    const today = new Date();
    for (let offset = 83; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      const day = map.get(key);
      cells.push({ date: key, pnl: day?.pnl ?? 0, tradeCount: day?.trade_count ?? 0 });
    }
    return cells;
  }, [calendarQuery.data]);

  async function refreshJournal() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["journal", "entries"] }),
      queryClient.invalidateQueries({ queryKey: ["journal", "stats"] }),
      queryClient.invalidateQueries({ queryKey: ["journal", "equity-curve"] }),
      queryClient.invalidateQueries({ queryKey: ["journal", "calendar"] }),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: (payload: JournalEntryPayload) => createJournalEntry(payload),
    onSuccess: async () => {
      setIsCreateOpen(false);
      await refreshJournal();
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<JournalEntryPayload> & { clear_exit?: boolean } }) => updateJournalEntry(id, payload),
    onSuccess: async () => {
      setEditingEntry(null);
      await refreshJournal();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteJournalEntry(id),
    onSuccess: refreshJournal,
  });

  const strategyRows = useMemo(() => summarizeGroups(entries, "strategy"), [entries]);
  const setupRows = useMemo(() => summarizeGroups(entries, "setup"), [entries]);

  async function handleCreate(payload: JournalEntryPayload) {
    await createMutation.mutateAsync(payload);
  }

  async function handleUpdate(payload: JournalEntryPayload) {
    if (!editingEntry) return;
    await updateMutation.mutateAsync({
      id: editingEntry.id,
      payload: {
        ...payload,
        clear_exit: !payload.exit_date && !payload.exit_price,
      },
    });
  }

  async function handleAddTag() {
    const entry = entries.find((item) => String(item.id) === tagTargetId);
    const tag = newTag.trim();
    if (!entry || !tag) return;
    await updateMutation.mutateAsync({
      id: entry.id,
      payload: { tags: Array.from(new Set([...(entry.tags || []), tag])) },
    });
    setNewTag("");
  }

  async function handleRenameTag(tag: string) {
    const next = (tagRenameDraft[tag] || "").trim();
    if (!next || next === tag) return;
    const affected = entries.filter((entry) => entry.tags.includes(tag));
    await Promise.all(
      affected.map((entry) =>
        updateJournalEntry(entry.id, {
          tags: entry.tags.map((value) => (value === tag ? next : value)).filter((value, index, array) => array.indexOf(value) === index),
        }),
      ),
    );
    await refreshJournal();
    setTagRenameDraft((current) => ({ ...current, [tag]: "" }));
  }

  async function handleDeleteTag(tag: string) {
    const affected = entries.filter((entry) => entry.tags.includes(tag));
    await Promise.all(affected.map((entry) => updateJournalEntry(entry.id, { tags: entry.tags.filter((value) => value !== tag) })));
    await refreshJournal();
  }

  return (
    <div className="space-y-4 p-4" data-testid="trade-journal-page">
      <TerminalPanel
        title="Trade Journal"
        subtitle="Execution review, PnL diagnostics, and behavioral pattern tracking."
        actions={<TerminalTabs items={tabs} value={activeTab} onChange={setActiveTab} variant="accent" />}
      >
        {activeTab === "journal" ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <TerminalInput value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)} placeholder="Filter symbol" />
              <TerminalInput as="select" value={strategyFilter} onChange={(event) => setStrategyFilter(event.target.value)}>
                <option value="">All strategies</option>
                {strategies.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {strategy}
                  </option>
                ))}
              </TerminalInput>
              <TerminalInput as="select" value={emotionFilter} onChange={(event) => setEmotionFilter(event.target.value)}>
                <option value="">All emotions</option>
                {Object.keys(emotionMeta).map((emotion) => (
                  <option key={emotion} value={emotion}>
                    {emotion}
                  </option>
                ))}
              </TerminalInput>
              <div className="grid grid-cols-2 gap-2">
                <TerminalInput type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                <TerminalInput type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </div>

            <div className="space-y-3">
              {entries.map((entry) => {
                const expanded = expandedId === entry.id;
                const positive = (entry.pnl ?? 0) >= 0;
                return (
                  <div
                    key={entry.id}
                    data-testid="journal-card"
                    className="w-full rounded-sm border border-terminal-border bg-terminal-bg/60 p-4 text-left transition-colors hover:border-terminal-accent/40"
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedId(expanded ? null : entry.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="grid gap-4 md:grid-cols-[1.25fr_1fr_0.8fr]">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className={entry.direction === "LONG" ? "text-terminal-pos" : "text-terminal-neg"}>
                            {entry.direction === "LONG" ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                          </span>
                          <span className="text-lg font-semibold text-terminal-text">{entry.symbol}</span>
                          {entry.strategy ? (
                            <span className="rounded-sm border border-terminal-accent/30 bg-terminal-accent/10 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-terminal-accent">
                              {entry.strategy}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-terminal-muted">{formatDate(entry.entry_date)}</div>
                        <div className="flex flex-wrap gap-2">
                          {entry.tags.map((tag) => (
                            <span key={tag} className="rounded-sm border border-terminal-border px-2 py-1 text-[10px] text-terminal-muted">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2 text-sm text-terminal-muted">
                        <div>
                          {formatMoney(entry.entry_price)} <span className="text-terminal-text">→</span> {entry.exit_price != null ? formatMoney(entry.exit_price) : "Open"}
                        </div>
                        <div>Qty {entry.quantity}</div>
                        <div>
                          {emotionMeta[entry.emotion || ""] ?? "•"} {entry.emotion || "untracked"}
                        </div>
                        <div>{Array.from({ length: entry.rating ?? 0 }).map((_, index) => "★").join("") || "No rating"}</div>
                      </div>

                      <div className="space-y-1 text-right">
                        <div className={`text-2xl font-semibold ${positive ? "text-terminal-pos" : "text-terminal-neg"}`} data-testid="journal-pnl">
                          {entry.pnl != null ? `${entry.pnl >= 0 ? "+" : ""}${formatMoney(entry.pnl)}` : "OPEN"}
                        </div>
                        <div className={positive ? "text-terminal-pos" : "text-terminal-neg"}>{formatPct(entry.pnl_pct)}</div>
                        <div className="text-xs text-terminal-muted">{truncate(entry.notes, 68) || "No notes"}</div>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="mt-4 grid gap-3 border-t border-terminal-border pt-4 text-sm text-terminal-muted md:grid-cols-2">
                        <div className="space-y-2">
                          <div>Setup: <span className="text-terminal-text">{entry.setup || "--"}</span></div>
                          <div>Fees: <span className="text-terminal-text">{formatMoney(entry.fees)}</span></div>
                          <div>Exit: <span className="text-terminal-text">{formatDate(entry.exit_date)}</span></div>
                          <div className="leading-relaxed text-terminal-text">{entry.notes || "No journal notes recorded."}</div>
                        </div>
                        <div className="flex items-start justify-end gap-2">
                          <TerminalButton
                            type="button"
                            size="sm"
                            variant="ghost"
                            leftIcon={<Pencil className="h-3.5 w-3.5" />}
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingEntry(entry);
                            }}
                          >
                            Edit
                          </TerminalButton>
                          <TerminalButton
                            type="button"
                            size="sm"
                            variant="danger"
                            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteMutation.mutateAsync(entry.id);
                            }}
                          >
                            Delete
                          </TerminalButton>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!entries.length ? <div className="rounded-sm border border-dashed border-terminal-border p-6 text-sm text-terminal-muted">No trades match the current filters.</div> : null}
            </div>
          </div>
        ) : null}

        {activeTab === "analytics" ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Total Trades", value: stats?.total_trades ?? 0, tone: "text-terminal-text" },
                { label: "Win Rate", value: `${(stats?.win_rate ?? 0).toFixed(1)}%`, tone: (stats?.win_rate ?? 0) >= 50 ? "text-terminal-pos" : "text-terminal-neg" },
                { label: "Profit Factor", value: stats?.profit_factor != null ? stats.profit_factor.toFixed(2) : "--", tone: (stats?.profit_factor ?? 0) >= 1 ? "text-terminal-pos" : "text-terminal-neg" },
                { label: "Avg Win/Loss", value: `${(stats?.avg_win_pct ?? 0).toFixed(1)}% / ${(stats?.avg_loss_pct ?? 0).toFixed(1)}%`, tone: "text-terminal-text" },
                { label: "Expectancy", value: formatMoney(stats?.expectancy ?? 0), tone: (stats?.expectancy ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg" },
                { label: "Current Streak", value: stats?.current_streak ?? 0, tone: (stats?.current_streak ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg" },
                { label: "Total PnL", value: formatMoney(stats?.total_pnl ?? 0), tone: (stats?.total_pnl ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg" },
                { label: "Avg PnL", value: formatMoney(stats?.avg_pnl ?? 0), tone: (stats?.avg_pnl ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg" },
              ].map((card) => (
                <div key={card.label} className="rounded-sm border border-terminal-border bg-terminal-bg/60 p-3">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">{card.label}</div>
                  <div className={`mt-2 text-2xl font-semibold ${card.tone}`}>{card.value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <TerminalPanel title="Equity Curve" bodyClassName="h-[320px]" className="bg-terminal-bg/30">
                <div className="h-full" data-testid="journal-equity-curve">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityCurveQuery.data ?? []}>
                      <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                      <XAxis dataKey="date" stroke="#7f8ea3" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#7f8ea3" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: "#0b1220", border: "1px solid rgba(148,163,184,0.2)" }}
                        formatter={(value: number | string | undefined) => [formatMoney(value == null ? null : Number(value)), "Cumulative PnL"]}
                      />
                      <Line type="monotone" dataKey="cumulative_pnl" stroke={(stats?.total_pnl ?? 0) >= 0 ? "#22c55e" : "#ef4444"} strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </TerminalPanel>

              <TerminalPanel title="Calendar Heatmap" bodyClassName="space-y-3" className="bg-terminal-bg/30">
                <div className="grid grid-cols-7 gap-2">
                  {calendarHeatmap.map((day) => {
                    const intensity = Math.min(1, Math.abs(day.pnl) / 1000);
                    const background =
                      day.tradeCount === 0
                        ? "bg-terminal-border/20"
                        : day.pnl >= 0
                          ? `rgba(34, 197, 94, ${0.2 + intensity * 0.6})`
                          : `rgba(239, 68, 68, ${0.2 + intensity * 0.6})`;
                    return (
                      <div key={day.date} className="aspect-square rounded-sm border border-terminal-border/40 p-1 text-[10px]" style={{ backgroundColor: background }}>
                        <div>{day.date.slice(8)}</div>
                        <div className="mt-3 text-[9px] text-terminal-text">{day.tradeCount ? `${day.pnl >= 0 ? "+" : ""}${Math.round(day.pnl)}` : ""}</div>
                      </div>
                    );
                  })}
                </div>
              </TerminalPanel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <TerminalPanel title="Performance by Strategy" bodyClassName="h-[300px]" className="bg-terminal-bg/30">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats?.by_strategy ?? []} layout="vertical" margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" horizontal={false} />
                    <XAxis type="number" stroke="#7f8ea3" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="strategy" width={110} stroke="#7f8ea3" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid rgba(148,163,184,0.2)" }} />
                    <Bar dataKey="avg_pnl" fill="#22c55e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </TerminalPanel>

              <TerminalPanel title="Performance by Day" bodyClassName="h-[300px]" className="bg-terminal-bg/30">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats?.by_day_of_week ?? []}>
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                    <XAxis dataKey="day" stroke="#7f8ea3" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#7f8ea3" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid rgba(148,163,184,0.2)" }} />
                    <Bar dataKey="avg_pnl" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </TerminalPanel>
            </div>
          </div>
        ) : null}

        {activeTab === "tags" ? (
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.2fr]">
            <TerminalPanel title="Strategies" className="bg-terminal-bg/30">
              <div className="space-y-2">
                {strategyRows.map((row) => (
                  <div key={row.name} className="rounded-sm border border-terminal-border bg-terminal-bg/40 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-terminal-text">{row.name}</div>
                      <div className="text-xs text-terminal-muted">{row.count} trades</div>
                    </div>
                    <div className="mt-1 text-xs text-terminal-muted">Win rate {row.winRate.toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </TerminalPanel>

            <TerminalPanel title="Setups" className="bg-terminal-bg/30">
              <div className="space-y-2">
                {setupRows.map((row) => (
                  <div key={row.name} className="rounded-sm border border-terminal-border bg-terminal-bg/40 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-terminal-text">{row.name}</div>
                      <div className="text-xs text-terminal-muted">{row.count} trades</div>
                    </div>
                    <div className="mt-1 text-xs text-terminal-muted">Win rate {row.winRate.toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </TerminalPanel>

            <TerminalPanel title="Free-Form Tags" className="bg-terminal-bg/30">
              <div className="space-y-4">
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <TerminalInput as="select" value={tagTargetId} onChange={(event) => setTagTargetId(event.target.value)}>
                    <option value="">Select trade</option>
                    {entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.symbol} · {formatDate(entry.entry_date)}
                      </option>
                    ))}
                  </TerminalInput>
                  <TerminalInput value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="Add tag to selected trade" />
                  <TerminalButton type="button" variant="accent" onClick={() => void handleAddTag()}>
                    Add
                  </TerminalButton>
                </div>

                <div className="space-y-2">
                  {tagSummary.map((row) => (
                    <div key={row.tag} className="rounded-sm border border-terminal-border bg-terminal-bg/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-terminal-text">#{row.tag}</div>
                          <div className="text-xs text-terminal-muted">{row.count} tagged trades</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <TerminalInput
                            size="sm"
                            value={tagRenameDraft[row.tag] ?? ""}
                            onChange={(event) => setTagRenameDraft((current) => ({ ...current, [row.tag]: event.target.value }))}
                            placeholder="Rename"
                          />
                          <TerminalButton type="button" size="sm" variant="ghost" onClick={() => void handleRenameTag(row.tag)}>
                            Save
                          </TerminalButton>
                          <TerminalButton type="button" size="sm" variant="danger" onClick={() => void handleDeleteTag(row.tag)}>
                            Delete
                          </TerminalButton>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!tagSummary.length ? <div className="text-sm text-terminal-muted">No tags available yet.</div> : null}
                </div>
              </div>
            </TerminalPanel>
          </div>
        ) : null}
      </TerminalPanel>

      <div className="fixed bottom-6 right-6 z-20">
        <TerminalButton
          type="button"
          variant="accent"
          size="lg"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => setIsCreateOpen(true)}
          data-testid="add-trade-button"
        >
          Add Trade
        </TerminalButton>
      </div>

      <JournalEntryForm
        open={isCreateOpen}
        mode="create"
        busy={createMutation.isPending}
        strategies={strategies}
        setups={setups}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreate}
      />
      <JournalEntryForm
        open={Boolean(editingEntry)}
        mode="edit"
        entry={editingEntry}
        busy={updateMutation.isPending}
        strategies={strategies}
        setups={setups}
        onClose={() => setEditingEntry(null)}
        onSubmit={handleUpdate}
      />
    </div>
  );
}
