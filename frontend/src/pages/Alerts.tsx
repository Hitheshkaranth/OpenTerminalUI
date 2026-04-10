import { useEffect, useMemo, useState } from "react";

import {
  createAlert,
  deleteAlert,
  fetchAlertHistory,
  fetchAlerts,
  testAlertDelivery,
  updateAlert,
} from "../api/client";
import { AlertBuilder } from "../components/Alerts/AlertBuilder";
import { TerminalTabs, type TerminalTabItem } from "../components/terminal/TerminalTabs";
import { useAlertsStore } from "../store/alertsStore";
import type { AlertRule, AlertTriggerEvent } from "../types";

const DELIVERY_SETTINGS_KEY = "ot.alert.delivery.defaults";

function alertsWsUrl(): string {
  const base = String(import.meta.env.VITE_API_BASE_URL || "/api");
  if (base.startsWith("http://") || base.startsWith("https://")) {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/alerts`;
    return url.toString();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${base.replace(/\/+$/, "")}/ws/alerts`;
}

function summarizeAlert(alert: AlertRule): string {
  const conditions =
    alert.conditions && alert.conditions.length
      ? alert.conditions
      : alert.threshold != null
        ? [{ field: "price", operator: alert.condition || "above", value: alert.threshold }]
        : [];
  const logic = alert.logic || "AND";
  return conditions.map((condition) => `${condition.field} ${condition.operator} ${condition.value ?? ""}`).join(` ${logic} `);
}

export function AlertsPage() {
  const queryTicker = useMemo(() => new URLSearchParams(window.location.search).get("ticker") || "", []);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertTriggerEvent[]>([]);
  const [tab, setTab] = useState("active");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertRule | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [defaultDeliveryConfig, setDefaultDeliveryConfig] = useState<Record<string, string>>(() => {
    try {
      const raw = window.localStorage.getItem(DELIVERY_SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const incrementUnread = useAlertsStore((s) => s.incrementUnread);
  const resetUnread = useAlertsStore((s) => s.resetUnread);

  async function loadAlerts() {
    const rows = await fetchAlerts();
    setAlerts(rows);
  }

  async function loadHistory(page = historyPage) {
    const response = await fetchAlertHistory(page, 10);
    setHistory(response.history || []);
    setHistoryPage(response.page);
    setHistoryTotal(response.total);
  }

  async function loadAll() {
    await Promise.all([loadAlerts(), loadHistory(1)]);
  }

  useEffect(() => {
    resetUnread();
    void loadAll();
  }, [resetUnread]);

  useEffect(() => {
    const ws = new WebSocket(alertsWsUrl());
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload?.type !== "alert_triggered") return;
        incrementUnread();
        window.dispatchEvent(
          new CustomEvent("ot:alert-toast", {
            detail: {
              title: `Alert: ${String(payload.symbol || "").toUpperCase() || "SYMBOL"}`,
              message: `${String(payload.condition || "Condition met")} @ ${payload.triggered_value ?? "NA"}`,
              variant: "warning",
              ttlMs: 5000,
            },
          }),
        );
        void loadHistory(1);
        void loadAlerts();
      } catch {
        // ignore bad socket payloads
      }
    };
    return () => ws.close();
  }, [incrementUnread]);

  const activeAlerts = useMemo(
    () =>
      alerts.filter((alert) => {
        const ticker = String(alert.symbol || alert.ticker || "").toUpperCase();
        const matchesTicker = queryTicker ? ticker.endsWith(queryTicker.toUpperCase()) : true;
        return alert.status !== "deleted" && matchesTicker;
      }),
    [alerts, queryTicker],
  );

  const tabs: TerminalTabItem[] = [
    { id: "active", label: "Active Alerts", badge: String(activeAlerts.length) },
    { id: "history", label: "Alert History", badge: String(historyTotal) },
    { id: "settings", label: "Delivery Settings" },
  ];

  async function handleSaveAlert(payload: {
    symbol: string;
    conditions: AlertRule["conditions"];
    logic: string;
    delivery_channels: string[];
    delivery_config: Record<string, string>;
    cooldown_minutes: number;
    expiry_date: string | null;
    max_triggers: number;
  }) {
    if (editingAlert?.id) {
      await updateAlert(editingAlert.id, payload);
    } else {
      await createAlert(payload);
    }
    setBuilderOpen(false);
    setEditingAlert(null);
    await loadAll();
  }

  async function handleTest(alertId: string) {
    await testAlertDelivery(alertId);
    window.dispatchEvent(
      new CustomEvent("ot:alert-toast", {
        detail: {
          title: "Test notification sent",
          message: "Configured alert delivery channels were exercised.",
          variant: "success",
          ttlMs: 4000,
        },
      }),
    );
  }

  return (
    <div className="space-y-4 p-3">
      <div className="flex flex-col gap-3 rounded border border-terminal-border bg-terminal-panel p-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-semibold text-terminal-accent">Alerts Console</div>
          <div className="text-xs text-terminal-muted">Multi-condition alerts with external delivery and trigger limits.</div>
        </div>
        <button
          className="rounded border border-terminal-accent bg-terminal-accent/15 px-3 py-2 text-xs text-terminal-accent"
          onClick={() => {
            setEditingAlert(
              queryTicker
                ? {
                    id: "",
                    ticker: queryTicker,
                    alert_type: "price",
                    condition: "above",
                    threshold: null,
                    note: "",
                    created_at: new Date().toISOString(),
                    symbol: queryTicker,
                  }
                : null,
            );
            setBuilderOpen(true);
          }}
        >
          Create New Alert
        </button>
      </div>

      <TerminalTabs items={tabs} value={tab} onChange={setTab} variant="accent" />

      {tab === "active" ? (
        <div className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
          {activeAlerts.length === 0 ? (
            <div className="text-xs text-terminal-muted">No alerts configured.</div>
          ) : (
            activeAlerts.map((alert) => (
              <div key={alert.id} className="grid gap-2 rounded border border-terminal-border bg-terminal-bg p-3 md:grid-cols-[1.5fr_2fr_1.2fr_auto]">
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-terminal-text">{alert.symbol || alert.ticker}</div>
                  <div className="text-terminal-muted">Status: {alert.status || "active"}</div>
                  <div className="text-terminal-muted">
                    Cooldown: {alert.cooldown_minutes || 0}m | Triggers: {alert.trigger_count || 0}
                    {alert.max_triggers ? ` / ${alert.max_triggers}` : " / unlimited"}
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="text-terminal-text">{summarizeAlert(alert)}</div>
                  <div className="text-terminal-muted">Logic: {alert.logic || "AND"}</div>
                  {alert.expiry_date ? <div className="text-terminal-muted">Expires: {new Date(alert.expiry_date).toLocaleString()}</div> : null}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="text-terminal-muted">Delivery</div>
                  <div className="flex flex-wrap gap-1">
                    {(alert.delivery_channels || alert.channels || []).map((channel) => (
                      <span key={`${alert.id}-${channel}`} className="rounded border border-terminal-border px-1.5 py-0.5 uppercase text-terminal-muted">
                        {channel}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-start justify-end gap-2 text-xs">
                  <button
                    className="rounded border border-terminal-border px-2 py-1 text-terminal-muted"
                    onClick={() => {
                      setEditingAlert(alert);
                      setBuilderOpen(true);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded border border-terminal-border px-2 py-1 text-terminal-muted"
                    onClick={() => void updateAlert(alert.id, { status: alert.status === "paused" ? "active" : "paused" }).then(loadAlerts)}
                  >
                    {alert.status === "paused" ? "Resume" : "Pause"}
                  </button>
                  <button
                    className="rounded border border-terminal-border px-2 py-1 text-terminal-muted"
                    onClick={() => void handleTest(alert.id)}
                  >
                    Test
                  </button>
                  <button
                    className="rounded border border-terminal-neg px-2 py-1 text-terminal-neg"
                    onClick={() => void deleteAlert(alert.id).then(loadAlerts)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="space-y-3 rounded border border-terminal-border bg-terminal-panel p-3">
          {history.length === 0 ? <div className="text-xs text-terminal-muted">No triggered alerts yet.</div> : null}
          {history.map((item) => (
            <div key={item.id} className="rounded border border-terminal-border bg-terminal-bg p-3 text-xs">
              <div className="font-semibold text-terminal-text">{item.symbol}</div>
              <div className="text-terminal-muted">{item.condition_type}</div>
              <div className="text-terminal-muted">
                Value: {item.triggered_value ?? "-"} | {new Date(item.triggered_at).toLocaleString()}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs">
            <button
              className="rounded border border-terminal-border px-2 py-1 text-terminal-muted disabled:opacity-40"
              disabled={historyPage <= 1}
              onClick={() => void loadHistory(historyPage - 1)}
            >
              Previous
            </button>
            <div className="text-terminal-muted">
              Page {historyPage} of {Math.max(1, Math.ceil(historyTotal / 10))}
            </div>
            <button
              className="rounded border border-terminal-border px-2 py-1 text-terminal-muted disabled:opacity-40"
              disabled={historyPage >= Math.ceil(historyTotal / 10)}
              onClick={() => void loadHistory(historyPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="space-y-3 rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
          <div className="font-semibold text-terminal-accent">Default Delivery Settings</div>
          <input
            aria-label="Default Webhook URL"
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2"
            value={defaultDeliveryConfig.webhook_url || ""}
            onChange={(event) => setDefaultDeliveryConfig((prev) => ({ ...prev, webhook_url: event.target.value }))}
            placeholder="Webhook URL"
          />
          <div className="grid gap-2 md:grid-cols-2">
            <input
              aria-label="Default Telegram Bot Token"
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-2"
              value={defaultDeliveryConfig.telegram_token || ""}
              onChange={(event) => setDefaultDeliveryConfig((prev) => ({ ...prev, telegram_token: event.target.value }))}
              placeholder="Telegram Bot Token"
            />
            <input
              aria-label="Default Telegram Chat ID"
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-2"
              value={defaultDeliveryConfig.telegram_chat_id || ""}
              onChange={(event) => setDefaultDeliveryConfig((prev) => ({ ...prev, telegram_chat_id: event.target.value }))}
              placeholder="Telegram Chat ID"
            />
          </div>
          <input
            aria-label="Default Discord Webhook URL"
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2"
            value={defaultDeliveryConfig.discord_webhook_url || ""}
            onChange={(event) => setDefaultDeliveryConfig((prev) => ({ ...prev, discord_webhook_url: event.target.value }))}
            placeholder="Discord Webhook URL"
          />
          <button
            className="rounded border border-terminal-accent bg-terminal-accent/15 px-3 py-2 text-xs text-terminal-accent"
            onClick={() => window.localStorage.setItem(DELIVERY_SETTINGS_KEY, JSON.stringify(defaultDeliveryConfig))}
          >
            Save Delivery Defaults
          </button>
        </div>
      ) : null}

      <AlertBuilder
        open={builderOpen}
        mode={editingAlert?.id ? "edit" : "create"}
        initialAlert={editingAlert}
        defaultDeliveryConfig={defaultDeliveryConfig}
        onClose={() => {
          setBuilderOpen(false);
          setEditingAlert(null);
        }}
        onSave={handleSaveAlert}
        onTestChannel={editingAlert?.id ? () => handleTest(editingAlert.id) : undefined}
      />
    </div>
  );
}
