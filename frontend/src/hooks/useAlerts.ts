import { useEffect, useMemo, useRef, useState } from "react";

import { useAlertsStore } from "../store/alertsStore";

export type AlertSocketEvent = {
  type: "alert_triggered";
  alert_id: string;
  symbol: string;
  condition: string;
  triggered_value: number | null;
  timestamp: string;
  source?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
};

export type AlertToastDetail = {
  title: string;
  message: string;
  variant: "warning";
  ttlMs: number;
};

type AlertNotification = {
  close?: () => void;
};

type AlertNotificationFactory = (title: string, options?: NotificationOptions) => AlertNotification;

type AlertWebSocket = {
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  close: () => void;
};

export type UseAlertsOptions = {
  enabled?: boolean;
  desktopEnabled?: boolean;
  soundEnabled?: boolean;
  reconnectMs?: number;
  maxReconnectMs?: number;
  onAlert?: (event: AlertSocketEvent) => void;
  webSocketFactory?: (url: string) => AlertWebSocket;
  notificationFactory?: AlertNotificationFactory;
  requestNotificationPermission?: () => Promise<NotificationPermission>;
  playSound?: () => void | Promise<void>;
};

export type UseAlertsState = {
  connected: boolean;
  lastAlert: AlertSocketEvent | null;
  error: string | null;
};

export function alertsWsUrl(): string {
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

export function parseAlertSocketEvent(raw: unknown): AlertSocketEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  if (payload.type !== "alert_triggered") return null;
  return {
    type: "alert_triggered",
    alert_id: String(payload.alert_id || ""),
    symbol: String(payload.symbol || "").toUpperCase(),
    condition: String(payload.condition || ""),
    triggered_value: typeof payload.triggered_value === "number" ? payload.triggered_value : null,
    timestamp: String(payload.timestamp || new Date().toISOString()),
    source: typeof payload.source === "string" ? payload.source : undefined,
    event_type: typeof payload.event_type === "string" ? payload.event_type : undefined,
    payload: payload.payload && typeof payload.payload === "object" ? (payload.payload as Record<string, unknown>) : undefined,
  };
}

export function buildAlertToast(event: AlertSocketEvent): AlertToastDetail {
  return {
    title: `Alert: ${event.symbol || "SYMBOL"}`,
    message: `${event.condition || "Condition met"} @ ${event.triggered_value ?? "NA"}`,
    variant: "warning",
    ttlMs: 5000,
  };
}

export function useAlerts(options: UseAlertsOptions = {}): UseAlertsState {
  const {
    enabled = true,
    desktopEnabled = true,
    soundEnabled = true,
    reconnectMs = 1200,
    maxReconnectMs = 8000,
    onAlert,
    webSocketFactory,
    notificationFactory,
    requestNotificationPermission,
    playSound,
  } = options;

  const incrementUnread = useAlertsStore((s) => s.incrementUnread);
  const [connected, setConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState<AlertSocketEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const socketRef = useRef<AlertWebSocket | null>(null);
  const activeRef = useRef(true);

  const wsFactory = useMemo(
    () =>
      webSocketFactory ||
      ((url: string) => {
        return new WebSocket(url) as unknown as AlertWebSocket;
      }),
    [webSocketFactory],
  );

  useEffect(() => {
    activeRef.current = true;
    if (!enabled) {
      return () => {
        activeRef.current = false;
      };
    }

    const notify = notificationFactory
      ? notificationFactory
      : typeof Notification !== "undefined"
        ? ((title: string, options?: NotificationOptions) => new Notification(title, options))
        : null;

    const requestPerm = requestNotificationPermission
      ? requestNotificationPermission
      : typeof Notification !== "undefined"
        ? () => Notification.requestPermission()
        : null;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const safeCloseSocket = () => {
      try {
        socketRef.current?.close();
      } catch {
        // noop
      }
      socketRef.current = null;
    };

    const scheduleReconnect = () => {
      if (!activeRef.current) return;
      clearReconnectTimer();
      attemptsRef.current += 1;
      const delay = Math.min(maxReconnectMs, reconnectMs * Math.max(1, attemptsRef.current));
      reconnectTimerRef.current = window.setTimeout(() => {
        void connect();
      }, delay);
    };

    const handleAlert = (alertEvent: AlertSocketEvent) => {
      incrementUnread();
      setLastAlert(alertEvent);
      onAlert?.(alertEvent);

      const toastDetail = buildAlertToast(alertEvent);
      window.dispatchEvent(new CustomEvent("ot:alert-toast", { detail: toastDetail }));

      if (soundEnabled && playSound) {
        Promise.resolve()
          .then(() => playSound())
          .catch(() => undefined);
      }

      if (!desktopEnabled || !notify) return;
      try {
        const permission = typeof Notification !== "undefined" ? Notification.permission : "denied";
        if (permission === "granted") {
          notify(`Alert: ${alertEvent.symbol}`, {
            body: `${alertEvent.condition} at ${alertEvent.triggered_value ?? "NA"}`,
          });
          return;
        }
        if (permission === "default" && requestPerm) {
          Promise.resolve()
            .then(() => requestPerm())
            .then((nextPermission) => {
              if (nextPermission !== "granted") return;
              notify(`Alert: ${alertEvent.symbol}`, {
                body: `${alertEvent.condition} at ${alertEvent.triggered_value ?? "NA"}`,
              });
            })
            .catch(() => "denied");
        }
      } catch {
        // noop
      }
    };

    const connect = async () => {
      if (!activeRef.current) return;
      safeCloseSocket();
      setError(null);
      try {
        const socket = wsFactory(alertsWsUrl());
        socketRef.current = socket;
        socket.onopen = () => {
          attemptsRef.current = 0;
          setConnected(true);
        };
        socket.onerror = () => {
          setError("alerts_ws_error");
        };
        socket.onclose = () => {
          setConnected(false);
          scheduleReconnect();
        };
        socket.onmessage = (event: MessageEvent) => {
          try {
            const parsed = parseAlertSocketEvent(JSON.parse(String(event.data)));
            if (!parsed) return;
            handleAlert(parsed);
          } catch {
            // noop
          }
        };
      } catch {
        setConnected(false);
        setError("alerts_ws_connect_error");
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      activeRef.current = false;
      setConnected(false);
      clearReconnectTimer();
      safeCloseSocket();
    };
  }, [
    desktopEnabled,
    enabled,
    incrementUnread,
    maxReconnectMs,
    notificationFactory,
    onAlert,
    playSound,
    reconnectMs,
    requestNotificationPermission,
    soundEnabled,
    wsFactory,
  ]);

  return { connected, lastAlert, error };
}
