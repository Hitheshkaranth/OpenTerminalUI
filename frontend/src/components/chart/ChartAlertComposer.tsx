import { useEffect, useState } from "react";

import type { ChartAlertDraft } from "../../shared/chart/chartAlerts";

type SubmitPayload = {
  conditionType: "price_above" | "price_below";
  threshold: number;
  cooldownSeconds: number;
  note: string;
  channels: string[];
};

type Props = {
  draft: ChartAlertDraft;
  submitting?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (payload: SubmitPayload) => void;
};

const CHANNELS = ["in_app", "push", "webhook", "email", "telegram"] as const;

export function ChartAlertComposer({ draft, submitting = false, error = null, onCancel, onSubmit }: Props) {
  const [conditionType, setConditionType] = useState<"price_above" | "price_below">(draft.suggestedConditionType);
  const [threshold, setThreshold] = useState<number>(draft.threshold);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [note, setNote] = useState<string>(draft.note);
  const [channels, setChannels] = useState<string[]>(["in_app"]);

  useEffect(() => {
    setConditionType(draft.suggestedConditionType);
    setThreshold(draft.threshold);
    setCooldownSeconds(0);
    setNote(draft.note);
    setChannels(["in_app"]);
  }, [draft]);

  const toggleChannel = (channel: string) => {
    setChannels((current) =>
      current.includes(channel) ? current.filter((value) => value !== channel) : [...current, channel],
    );
  };

  return (
    <div
      className="rounded border border-terminal-accent/70 bg-terminal-panel/95 p-3 shadow-xl"
      data-testid="chart-alert-composer"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-terminal-accent">{draft.title}</div>
          <div className="mt-1 text-[11px] text-terminal-muted">
            {draft.symbol} | {draft.chartContext.sourceLabel} | {draft.chartContext.timeframe}
          </div>
        </div>
        <button
          type="button"
          className="rounded border border-terminal-border px-2 py-0.5 text-[10px] text-terminal-muted"
          onClick={onCancel}
          disabled={submitting}
        >
          Close
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        <label className="text-[11px] text-terminal-muted">
          Condition
          <select
            value={conditionType}
            onChange={(event) => setConditionType(event.target.value as "price_above" | "price_below")}
            className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text"
            data-testid="chart-alert-condition"
          >
            <option value="price_above">Price Above</option>
            <option value="price_below">Price Below</option>
          </select>
        </label>
        <label className="text-[11px] text-terminal-muted">
          Threshold
          <input
            type="number"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text"
            data-testid="chart-alert-threshold"
          />
        </label>
        <label className="text-[11px] text-terminal-muted">
          Cooldown
          <input
            type="number"
            min={0}
            value={cooldownSeconds}
            onChange={(event) => setCooldownSeconds(Math.max(0, Number(event.target.value)))}
            className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text"
            data-testid="chart-alert-cooldown"
          />
        </label>
        <label className="text-[11px] text-terminal-muted md:col-span-1">
          Note
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text"
            data-testid="chart-alert-note"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        {CHANNELS.map((channel) => {
          const active = channels.includes(channel);
          return (
            <button
              key={channel}
              type="button"
              onClick={() => toggleChannel(channel)}
              className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                active ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
              }`}
              data-testid={`chart-alert-channel-${channel}`}
            >
              {channel}
            </button>
          );
        })}
      </div>

      {error ? <div className="mt-2 text-[11px] text-terminal-neg">{error}</div> : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded border border-terminal-accent bg-terminal-accent/15 px-2 py-1 text-[11px] text-terminal-accent disabled:opacity-50"
          onClick={() =>
            onSubmit({
              conditionType,
              threshold,
              cooldownSeconds,
              note,
              channels,
            })
          }
          disabled={submitting || !Number.isFinite(threshold)}
          data-testid="chart-alert-submit"
        >
          {submitting ? "Creating..." : "Create Alert"}
        </button>
      </div>
    </div>
  );
}
