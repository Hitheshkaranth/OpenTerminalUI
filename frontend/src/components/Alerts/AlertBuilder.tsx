import { useEffect, useMemo, useState } from "react";

import type { AlertCondition, AlertRule } from "../../types";
import { TerminalModal } from "../terminal/TerminalModal";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initialAlert?: AlertRule | null;
  defaultDeliveryConfig?: Record<string, string>;
  onClose: () => void;
  onSave: (payload: {
    symbol: string;
    conditions: AlertCondition[];
    logic: string;
    delivery_channels: string[];
    delivery_config: Record<string, string>;
    cooldown_minutes: number;
    expiry_date: string | null;
    max_triggers: number;
  }) => Promise<void>;
  onTestChannel?: (channel: string) => Promise<void>;
};

const FIELD_OPTIONS = [
  { value: "price", label: "Price", operators: ["above", "below", "cross_above", "cross_below"] },
  { value: "change_pct", label: "% Change", operators: ["above", "below"] },
  { value: "volume", label: "Volume", operators: ["above", "spike"] },
  { value: "rsi_14", label: "RSI(14)", operators: ["above", "below"] },
  { value: "macd_signal", label: "MACD Signal Cross", operators: ["cross_above", "cross_below"] },
  { value: "ema_cross", label: "EMA Cross", operators: ["cross_above", "cross_below"] },
  { value: "oi_change", label: "OI Change", operators: ["above", "below"] },
  { value: "iv", label: "IV", operators: ["above", "below"] },
] as const;

const DELIVERY_CHANNELS = [
  { value: "in_app", label: "In-App" },
  { value: "webhook", label: "Webhook" },
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
] as const;

const DEFAULT_CONDITION: AlertCondition = { field: "price", operator: "above", value: 2500, params: {} };

function conditionLabel(condition: AlertCondition): string {
  const field = FIELD_OPTIONS.find((option) => option.value === condition.field);
  const op = String(condition.operator || "").replace(/_/g, " ");
  return `${field?.label || condition.field} ${op} ${condition.value ?? ""}`.trim();
}

function normalizeAlert(alert?: AlertRule | null, defaults?: Record<string, string>) {
  const conditions =
    alert?.conditions && alert.conditions.length
      ? alert.conditions
      : alert?.threshold != null
        ? [{ field: "price", operator: alert.condition || "above", value: alert.threshold, params: {} }]
        : [DEFAULT_CONDITION];
  return {
    symbol: alert?.symbol || alert?.ticker || "NSE:RELIANCE",
    conditions,
    logic: alert?.logic || "AND",
    delivery_channels: alert?.delivery_channels || alert?.channels || ["in_app"],
    delivery_config: {
      webhook_url: String(alert?.delivery_config?.webhook_url || defaults?.webhook_url || ""),
      telegram_token: String(alert?.delivery_config?.telegram_token || defaults?.telegram_token || ""),
      telegram_chat_id: String(alert?.delivery_config?.telegram_chat_id || defaults?.telegram_chat_id || ""),
      discord_webhook_url: String(alert?.delivery_config?.discord_webhook_url || defaults?.discord_webhook_url || ""),
    },
    cooldown_minutes: Number(alert?.cooldown_minutes || 0),
    expiry_date: alert?.expiry_date ? String(alert.expiry_date).slice(0, 16) : "",
    max_triggers: Number(alert?.max_triggers || 0),
  };
}

export function AlertBuilder({
  open,
  mode,
  initialAlert,
  defaultDeliveryConfig,
  onClose,
  onSave,
  onTestChannel,
}: Props) {
  const [symbol, setSymbol] = useState("NSE:RELIANCE");
  const [conditions, setConditions] = useState<AlertCondition[]>([DEFAULT_CONDITION]);
  const [logic, setLogic] = useState("AND");
  const [deliveryChannels, setDeliveryChannels] = useState<string[]>(["in_app"]);
  const [deliveryConfig, setDeliveryConfig] = useState<Record<string, string>>({
    webhook_url: "",
    telegram_token: "",
    telegram_chat_id: "",
    discord_webhook_url: "",
  });
  const [cooldownMinutes, setCooldownMinutes] = useState(0);
  const [expiryDate, setExpiryDate] = useState("");
  const [maxTriggers, setMaxTriggers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = normalizeAlert(initialAlert, defaultDeliveryConfig);
    setSymbol(next.symbol);
    setConditions(next.conditions);
    setLogic(next.logic);
    setDeliveryChannels(next.delivery_channels);
    setDeliveryConfig(next.delivery_config);
    setCooldownMinutes(next.cooldown_minutes);
    setExpiryDate(next.expiry_date);
    setMaxTriggers(next.max_triggers);
    setError(null);
  }, [defaultDeliveryConfig, initialAlert, open]);

  const preview = useMemo(() => {
    const joined = conditions.map(conditionLabel).join(` ${logic} `);
    return `Alert when ${symbol || "SYMBOL"} ${joined}`;
  }, [conditions, logic, symbol]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        symbol: symbol.trim().toUpperCase(),
        conditions,
        logic,
        delivery_channels: deliveryChannels,
        delivery_config: deliveryConfig,
        cooldown_minutes: Math.max(0, cooldownMinutes),
        expiry_date: expiryDate ? new Date(expiryDate).toISOString() : null,
        max_triggers: Math.max(0, maxTriggers),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save alert");
      return;
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title={mode === "edit" ? "Edit Alert" : "Create Alert"}
      subtitle="Multi-condition rule builder"
      size="lg"
      busy={saving}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="rounded border border-terminal-border px-3 py-1 text-xs text-terminal-muted" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded border border-terminal-accent bg-terminal-accent/15 px-3 py-1 text-xs text-terminal-accent"
            onClick={() => void handleSave()}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        <section className="space-y-2">
          <div className="font-semibold text-terminal-accent">Symbol</div>
          <input
            aria-label="Symbol"
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2 uppercase"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            placeholder="NSE:RELIANCE"
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-terminal-accent">Conditions</div>
            <button
              type="button"
              className="rounded border border-terminal-border px-2 py-1 text-terminal-muted"
              onClick={() => setConditions((prev) => [...prev, { ...DEFAULT_CONDITION, params: {} }])}
            >
              Add Condition
            </button>
          </div>
          <div className="space-y-2">
            {conditions.map((condition, index) => {
              const fieldMeta = FIELD_OPTIONS.find((option) => option.value === condition.field) || FIELD_OPTIONS[0];
              return (
                <div key={`${condition.field}-${index}`} className="grid grid-cols-1 gap-2 rounded border border-terminal-border bg-terminal-bg p-2 md:grid-cols-12">
                  <select
                    aria-label={`Condition field ${index + 1}`}
                    className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 md:col-span-3"
                    value={condition.field}
                    onChange={(event) => {
                      const nextField = event.target.value;
                      const operators = FIELD_OPTIONS.find((option) => option.value === nextField)?.operators || ["above"];
                      setConditions((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, field: nextField, operator: operators[0], params: {} } : row,
                        ),
                      );
                    }}
                  >
                    {FIELD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Condition operator ${index + 1}`}
                    className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 md:col-span-2"
                    value={condition.operator}
                    onChange={(event) =>
                      setConditions((prev) =>
                        prev.map((row, rowIndex) => (rowIndex === index ? { ...row, operator: event.target.value } : row)),
                      )
                    }
                  >
                    {fieldMeta.operators.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Condition value ${index + 1}`}
                    type="number"
                    className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 md:col-span-2"
                    value={String(condition.value ?? "")}
                    onChange={(event) =>
                      setConditions((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, value: Number(event.target.value), params: row.params || {} } : row,
                        ),
                      )
                    }
                  />
                  {condition.field === "ema_cross" ? (
                    <>
                      <input
                        aria-label={`EMA fast ${index + 1}`}
                        type="number"
                        className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 md:col-span-2"
                        value={String(condition.params?.fast_period || 9)}
                        onChange={(event) =>
                          setConditions((prev) =>
                            prev.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, params: { ...(row.params || {}), fast_period: Number(event.target.value) } }
                                : row,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label={`EMA slow ${index + 1}`}
                        type="number"
                        className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 md:col-span-2"
                        value={String(condition.params?.slow_period || 21)}
                        onChange={(event) =>
                          setConditions((prev) =>
                            prev.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, params: { ...(row.params || {}), slow_period: Number(event.target.value) } }
                                : row,
                            ),
                          )
                        }
                      />
                    </>
                  ) : condition.field === "volume" && condition.operator === "spike" ? (
                    <input
                      aria-label={`Volume multiplier ${index + 1}`}
                      type="number"
                      className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 md:col-span-4"
                      value={String(condition.params?.multiplier || 2)}
                      onChange={(event) =>
                        setConditions((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, params: { ...(row.params || {}), multiplier: Number(event.target.value) } }
                              : row,
                          ),
                        )
                      }
                    />
                  ) : (
                    <div className="md:col-span-4" />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove condition ${index + 1}`}
                    className="rounded border border-terminal-neg px-2 py-1 text-terminal-neg md:col-span-1"
                    onClick={() => setConditions((prev) => (prev.length > 1 ? prev.filter((_, rowIndex) => rowIndex !== index) : prev))}
                  >
                    X
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-terminal-muted">Logic</span>
            <button
              type="button"
              className={`rounded border px-2 py-1 ${logic === "AND" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
              onClick={() => setLogic("AND")}
            >
              AND
            </button>
            <button
              type="button"
              className={`rounded border px-2 py-1 ${logic === "OR" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
              onClick={() => setLogic("OR")}
            >
              OR
            </button>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-terminal-muted">{preview}</div>
        </section>

        <section className="space-y-2">
          <div className="font-semibold text-terminal-accent">Delivery</div>
          <div className="flex flex-wrap gap-2">
            {DELIVERY_CHANNELS.map((channel) => {
              const active = deliveryChannels.includes(channel.value);
              return (
                <label key={channel.value} className="flex items-center gap-2 rounded border border-terminal-border px-2 py-1">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() =>
                      setDeliveryChannels((prev) =>
                        prev.includes(channel.value) ? prev.filter((value) => value !== channel.value) : [...prev, channel.value],
                      )
                    }
                  />
                  <span>{channel.label}</span>
                  {active && initialAlert?.id && onTestChannel ? (
                    <button
                      type="button"
                      className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted"
                      onClick={() => void onTestChannel(channel.value)}
                    >
                      Test
                    </button>
                  ) : null}
                </label>
              );
            })}
          </div>
          {deliveryChannels.includes("webhook") ? (
            <input
              aria-label="Webhook URL"
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2"
              value={deliveryConfig.webhook_url || ""}
              onChange={(event) => setDeliveryConfig((prev) => ({ ...prev, webhook_url: event.target.value }))}
              placeholder="https://example.com/hook"
            />
          ) : null}
          {deliveryChannels.includes("telegram") ? (
            <div className="grid gap-2 md:grid-cols-2">
              <input
                aria-label="Telegram Bot Token"
                className="rounded border border-terminal-border bg-terminal-bg px-2 py-2"
                value={deliveryConfig.telegram_token || ""}
                onChange={(event) => setDeliveryConfig((prev) => ({ ...prev, telegram_token: event.target.value }))}
                placeholder="Bot Token"
              />
              <input
                aria-label="Telegram Chat ID"
                className="rounded border border-terminal-border bg-terminal-bg px-2 py-2"
                value={deliveryConfig.telegram_chat_id || ""}
                onChange={(event) => setDeliveryConfig((prev) => ({ ...prev, telegram_chat_id: event.target.value }))}
                placeholder="Chat ID"
              />
            </div>
          ) : null}
          {deliveryChannels.includes("discord") ? (
            <input
              aria-label="Discord Webhook URL"
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2"
              value={deliveryConfig.discord_webhook_url || ""}
              onChange={(event) => setDeliveryConfig((prev) => ({ ...prev, discord_webhook_url: event.target.value }))}
              placeholder="https://discord.com/api/webhooks/..."
            />
          ) : null}
        </section>

        <section className="grid gap-2 md:grid-cols-3">
          <div className="space-y-1">
            <div className="font-semibold text-terminal-accent">Cooldown</div>
            <input
              aria-label="Cooldown Minutes"
              type="number"
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2"
              value={cooldownMinutes}
              onChange={(event) => setCooldownMinutes(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-terminal-accent">Expiry</div>
            <input
              aria-label="Expiry Date"
              type="datetime-local"
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-terminal-accent">Max Triggers</div>
            <input
              aria-label="Max Triggers"
              type="number"
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2"
              value={maxTriggers}
              onChange={(event) => setMaxTriggers(Number(event.target.value))}
            />
          </div>
        </section>

        {error ? <div className="text-terminal-neg">{error}</div> : null}
      </div>
    </TerminalModal>
  );
}
