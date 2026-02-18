import { useEffect, useMemo, useState } from "react";

import { fetchAlertHistory, fetchAlerts } from "../api/client";
import { AlertCreateForm } from "../components/Alerts/AlertCreateForm";
import { AlertHistory } from "../components/Alerts/AlertHistory";
import { AlertList } from "../components/Alerts/AlertList";
import { useAlertsStore } from "../store/alertsStore";
import type { AlertRule, AlertTriggerEvent } from "../types";

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

export function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertTriggerEvent[]>([]);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const incrementUnread = useAlertsStore((s) => s.incrementUnread);
  const resetUnread = useAlertsStore((s) => s.resetUnread);

  async function load() {
    const [alertsRows, hist] = await Promise.all([fetchAlerts(), fetchAlertHistory(1, 50)]);
    setAlerts(alertsRows);
    setHistory(hist.history || []);
  }

  useEffect(() => {
    resetUnread();
    void load();
  }, [resetUnread]);

  useEffect(() => {
    const ws = new WebSocket(alertsWsUrl());
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload?.type !== "alert_triggered") return;
        incrementUnread();
        setHistory((prev) => [
          {
            id: String(payload.alert_id) + ":" + String(payload.timestamp),
            alert_id: String(payload.alert_id),
            symbol: String(payload.symbol || ""),
            condition_type: String(payload.condition || ""),
            triggered_value: typeof payload.triggered_value === "number" ? payload.triggered_value : null,
            triggered_at: String(payload.timestamp || new Date().toISOString()),
          },
          ...prev,
        ]);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`Alert: ${payload.symbol}`, {
            body: `${payload.condition} at ${payload.triggered_value ?? "NA"}`,
          });
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [incrementUnread]);

  const activeAlerts = useMemo(() => alerts.filter((a) => (a.status || "active") !== "deleted"), [alerts]);

  return (
    <div
      className="space-y-3 p-3"
      onTouchStart={(e) => setTouchStartX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchStartX == null || history.length === 0) return;
        const delta = (e.changedTouches[0]?.clientX ?? 0) - touchStartX;
        setTouchStartX(null);
        if (delta < -80) {
          setHistory((prev) => prev.slice(1));
        }
      }}
    >
      <AlertCreateForm onCreated={() => void load()} />
      <AlertList alerts={activeAlerts} onChanged={() => void load()} />
      <AlertHistory history={history} />
    </div>
  );
}
