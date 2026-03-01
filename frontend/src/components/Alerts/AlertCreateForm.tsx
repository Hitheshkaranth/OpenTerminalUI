import { useState } from "react";

import { createAlert } from "../../api/client";

type Props = {
  onCreated: () => void;
};

const CONDITION_OPTIONS = [
  { value: "price_above", label: "Price Above" },
  { value: "price_below", label: "Price Below" },
  { value: "pct_change", label: "Pct Change" },
  { value: "volume_spike", label: "Volume Spike" },
  { value: "indicator_crossover", label: "Indicator Crossover" },
  { value: "custom_expression", label: "Custom Expression" },
];

export function AlertCreateForm({ onCreated }: Props) {
  const [symbol, setSymbol] = useState("NSE:RELIANCE");
  const [conditionType, setConditionType] = useState("price_above");
  const [threshold, setThreshold] = useState(3000);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [customExpression, setCustomExpression] = useState("ltp > 3000 and change_pct > 1");
  const [channels, setChannels] = useState<string[]>(["in_app"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      // Fire-and-forget: don't block the alert creation on the notification permission dialog.
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
      const parameters: Record<string, unknown> = {};
      if (conditionType === "custom_expression") {
        parameters.expression = customExpression;
      } else if (conditionType === "volume_spike") {
        parameters.multiplier = Math.max(1, threshold);
        parameters.lookback = 20;
      } else {
        parameters.threshold = threshold;
      }
      await createAlert({
        symbol: symbol.trim().toUpperCase(),
        condition_type: conditionType,
        parameters,
        cooldown_seconds: cooldownSeconds,
        channels,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create alert");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="text-sm font-semibold text-terminal-accent">Create Alert</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        <input
          className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs uppercase"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="NSE:RELIANCE"
        />
        <select
          className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
          value={conditionType}
          onChange={(e) => setConditionType(e.target.value)}
        >
          {CONDITION_OPTIONS.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
        {conditionType === "custom_expression" ? (
          <input
            className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs md:col-span-2"
            value={customExpression}
            onChange={(e) => setCustomExpression(e.target.value)}
            placeholder="ltp > 3000 and change_pct > 1"
          />
        ) : (
          <input
            type="number"
            className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            placeholder="Threshold"
          />
        )}
        <input
          type="number"
          className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
          value={cooldownSeconds}
          onChange={(e) => setCooldownSeconds(Math.max(0, Number(e.target.value)))}
          placeholder="Cooldown sec"
        />
        <button
          className="rounded border border-terminal-accent bg-terminal-accent/20 px-2 py-1 text-xs text-terminal-accent"
          onClick={() => void submit()}
          disabled={loading}
        >
          {loading ? "Creating..." : "Create"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {["in_app", "webhook", "email", "telegram", "push"].map((ch) => {
          const active = channels.includes(ch);
          return (
            <button
              key={ch}
              type="button"
              onClick={() =>
                setChannels((prev) =>
                  prev.includes(ch) ? prev.filter((x) => x !== ch) : [...prev, ch],
                )
              }
              className={`rounded border px-2 py-1 uppercase ${
                active ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
              }`}
            >
              {ch}
            </button>
          );
        })}
      </div>
      {error && <div className="text-xs text-terminal-neg">{error}</div>}
    </div>
  );
}
