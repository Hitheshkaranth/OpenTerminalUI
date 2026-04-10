import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";

import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalModal } from "../terminal/TerminalModal";
import type { JournalEntry } from "../../types";
import type { JournalEntryPayload } from "../../api/client";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  entry?: JournalEntry | null;
  busy?: boolean;
  strategies: string[];
  setups: string[];
  onClose: () => void;
  onSubmit: (payload: JournalEntryPayload) => Promise<void> | void;
};

type FormState = {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryDate: string;
  entryPrice: string;
  exitDate: string;
  exitPrice: string;
  quantity: string;
  fees: string;
  strategy: string;
  setup: string;
  emotion: string;
  rating: number;
  notes: string;
  tags: string;
};

const emotionOptions = [
  { value: "confident", label: "Confident", emoji: "😎" },
  { value: "fearful", label: "Fearful", emoji: "😬" },
  { value: "greedy", label: "Greedy", emoji: "🤑" },
  { value: "neutral", label: "Neutral", emoji: "😐" },
] as const;

function toLocalDateTimeValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input: number) => `${input}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildInitialState(entry?: JournalEntry | null): FormState {
  return {
    symbol: entry?.symbol ?? "",
    direction: entry?.direction ?? "LONG",
    entryDate: toLocalDateTimeValue(entry?.entry_date),
    entryPrice: entry?.entry_price ? String(entry.entry_price) : "",
    exitDate: toLocalDateTimeValue(entry?.exit_date),
    exitPrice: entry?.exit_price != null ? String(entry.exit_price) : "",
    quantity: entry?.quantity ? String(entry.quantity) : "1",
    fees: entry?.fees != null ? String(entry.fees) : "0",
    strategy: entry?.strategy ?? "",
    setup: entry?.setup ?? "",
    emotion: entry?.emotion ?? "neutral",
    rating: entry?.rating ?? 0,
    notes: entry?.notes ?? "",
    tags: entry?.tags?.join(", ") ?? "",
  };
}

export function JournalEntryForm({
  open,
  mode,
  entry,
  busy = false,
  strategies,
  setups,
  onClose,
  onSubmit,
}: Props) {
  const [state, setState] = useState<FormState>(() => buildInitialState(entry));

  useEffect(() => {
    if (open) setState(buildInitialState(entry));
  }, [entry, open]);

  const strategyOptions = useMemo(
    () => Array.from(new Set([state.strategy, ...strategies].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [state.strategy, strategies],
  );
  const setupOptions = useMemo(
    () => Array.from(new Set([state.setup, ...setups].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [state.setup, setups],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      symbol: state.symbol.trim().toUpperCase(),
      direction: state.direction,
      entry_date: new Date(state.entryDate).toISOString(),
      entry_price: Number(state.entryPrice),
      exit_date: state.exitDate ? new Date(state.exitDate).toISOString() : null,
      exit_price: state.exitPrice ? Number(state.exitPrice) : null,
      quantity: Number(state.quantity),
      fees: Number(state.fees || 0),
      strategy: state.strategy.trim() || null,
      setup: state.setup.trim() || null,
      emotion: state.emotion || null,
      rating: state.rating || null,
      notes: state.notes.trim() || null,
      tags: state.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
  }

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={mode === "create" ? "Add Trade" : `Edit ${entry?.symbol ?? "Trade"}`}
      subtitle="Capture execution, psychology, and post-trade review in one place."
      footer={
        <div className="flex items-center justify-end gap-2">
          <TerminalButton type="button" size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </TerminalButton>
          <TerminalButton type="submit" form="journal-entry-form" size="sm" variant="accent" loading={busy}>
            Save
          </TerminalButton>
        </div>
      }
    >
      <form id="journal-entry-form" className="space-y-4" onSubmit={handleSubmit} data-testid="journal-entry-form">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Symbol</div>
            <TerminalInput
              required
              value={state.symbol}
              onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
              placeholder="RELIANCE"
            />
          </label>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Direction</div>
            <div className="grid grid-cols-2 gap-2">
              {(["LONG", "SHORT"] as const).map((direction) => (
                <TerminalButton
                  key={direction}
                  type="button"
                  variant={state.direction === direction ? (direction === "LONG" ? "success" : "danger") : "default"}
                  onClick={() => setState((current) => ({ ...current, direction }))}
                >
                  {direction}
                </TerminalButton>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Entry Date</div>
            <TerminalInput required type="datetime-local" value={state.entryDate} onChange={(event) => setState((current) => ({ ...current, entryDate: event.target.value }))} />
          </label>
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Entry Price</div>
            <TerminalInput required type="number" min="0" step="0.01" value={state.entryPrice} onChange={(event) => setState((current) => ({ ...current, entryPrice: event.target.value }))} />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Exit Date</div>
            <TerminalInput type="datetime-local" value={state.exitDate} onChange={(event) => setState((current) => ({ ...current, exitDate: event.target.value }))} />
          </label>
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Exit Price</div>
            <TerminalInput type="number" min="0" step="0.01" value={state.exitPrice} onChange={(event) => setState((current) => ({ ...current, exitPrice: event.target.value }))} />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Quantity</div>
            <TerminalInput required type="number" min="1" step="1" value={state.quantity} onChange={(event) => setState((current) => ({ ...current, quantity: event.target.value }))} />
          </label>
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Fees</div>
            <TerminalInput type="number" min="0" step="0.01" value={state.fees} onChange={(event) => setState((current) => ({ ...current, fees: event.target.value }))} />
          </label>
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Emotion</div>
            <div className="grid grid-cols-2 gap-2">
              {emotionOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-sm border px-2 py-2 text-left text-[11px] transition-colors ${
                    state.emotion === option.value
                      ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                      : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                  }`}
                  onClick={() => setState((current) => ({ ...current, emotion: option.value }))}
                >
                  <span className="mr-1">{option.emoji}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Strategy</div>
            <TerminalInput as="select" value={state.strategy} onChange={(event) => setState((current) => ({ ...current, strategy: event.target.value }))}>
              <option value="">Select strategy</option>
              {strategyOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </TerminalInput>
            <TerminalInput
              placeholder="Or type a new strategy"
              value={state.strategy}
              onChange={(event) => setState((current) => ({ ...current, strategy: event.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Setup</div>
            <TerminalInput as="select" value={state.setup} onChange={(event) => setState((current) => ({ ...current, setup: event.target.value }))}>
              <option value="">Select setup</option>
              {setupOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </TerminalInput>
            <TerminalInput
              placeholder="Or type a new setup"
              value={state.setup}
              onChange={(event) => setState((current) => ({ ...current, setup: event.target.value }))}
            />
          </label>
        </div>

        <label className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Tags</div>
          <TerminalInput value={state.tags} onChange={(event) => setState((current) => ({ ...current, tags: event.target.value }))} placeholder="breakout, pullback, revenge-risk" />
        </label>

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Rating</div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }, (_, index) => index + 1).map((rating) => (
              <button key={rating} type="button" onClick={() => setState((current) => ({ ...current, rating }))} className="rounded-sm p-1 text-terminal-muted hover:text-terminal-accent">
                <Star className={`h-5 w-5 ${state.rating >= rating ? "fill-current text-amber-300" : ""}`} />
              </button>
            ))}
          </div>
        </div>

        <label className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">Notes</div>
          <TerminalInput
            as="textarea"
            rows={5}
            value={state.notes}
            onChange={(event) => setState((current) => ({ ...current, notes: event.target.value }))}
            placeholder="What worked, what failed, and what to repeat next time."
          />
        </label>
      </form>
    </TerminalModal>
  );
}
