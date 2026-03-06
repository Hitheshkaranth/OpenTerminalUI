import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAlertToast, parseAlertSocketEvent, useAlerts } from "../hooks/useAlerts";
import { useAlertsStore } from "../store/alertsStore";

class FakeWebSocket {
  public onopen: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public closed = false;

  close() {
    this.closed = true;
  }
}

function Probe(props: {
  desktopEnabled?: boolean;
  soundEnabled?: boolean;
  webSocketFactory: (url: string) => FakeWebSocket;
  notificationFactory?: (title: string, options?: NotificationOptions) => unknown;
  requestNotificationPermission?: () => Promise<NotificationPermission>;
  playSound?: () => void | Promise<void>;
}) {
  useAlerts(props);
  return null;
}

describe("useAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAlertsStore.getState().resetUnread();
  });

  it("parses alert payloads deterministically", () => {
    const parsed = parseAlertSocketEvent({
      type: "alert_triggered",
      alert_id: "a-1",
      symbol: "nse:reliance",
      condition: "price_above",
      triggered_value: 2550,
      timestamp: "2026-03-05T00:00:00Z",
    });
    expect(parsed?.symbol).toBe("NSE:RELIANCE");
    expect(buildAlertToast(parsed!)).toEqual({
      title: "Alert: NSE:RELIANCE",
      message: "price_above @ 2550",
      variant: "warning",
      ttlMs: 5000,
    });
  });

  it("increments unread and emits toast + desktop notification on alert messages", async () => {
    const fakeSocket = new FakeWebSocket();
    const toastSpy = vi.fn();
    const notificationSpy = vi.fn();
    const requestPermSpy = vi.fn().mockResolvedValue("granted");
    const soundSpy = vi.fn();

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "granted" },
    });

    window.addEventListener("ot:alert-toast", toastSpy as EventListener);
    render(
      <Probe
        webSocketFactory={() => fakeSocket}
        notificationFactory={notificationSpy}
        requestNotificationPermission={requestPermSpy}
        playSound={soundSpy}
      />,
    );

    act(() => {
      fakeSocket.onopen?.(new Event("open"));
      fakeSocket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "alert_triggered",
            alert_id: "a-1",
            symbol: "NSE:RELIANCE",
            condition: "price_above",
            triggered_value: 2550,
            timestamp: "2026-03-05T00:00:00Z",
          }),
        }),
      );
    });

    await waitFor(() => expect(useAlertsStore.getState().unreadCount).toBe(1));
    await waitFor(() => expect(notificationSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(soundSpy).toHaveBeenCalledTimes(1));
    expect(requestPermSpy).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener("ot:alert-toast", toastSpy as EventListener);
  });

  it("keeps workflow non-blocking when notification/sound fail", async () => {
    const fakeSocket = new FakeWebSocket();
    const notificationSpy = vi.fn(() => {
      throw new Error("notification failure");
    });
    const soundSpy = vi.fn().mockRejectedValue(new Error("sound failure"));

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "granted" },
    });

    render(
      <Probe
        webSocketFactory={() => fakeSocket}
        notificationFactory={notificationSpy}
        playSound={soundSpy}
      />,
    );

    act(() => {
      fakeSocket.onopen?.(new Event("open"));
      fakeSocket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "alert_triggered",
            alert_id: "a-2",
            symbol: "NSE:TCS",
            condition: "volume_spike",
            triggered_value: 100,
            timestamp: "2026-03-05T00:00:00Z",
          }),
        }),
      );
    });

    await waitFor(() => expect(useAlertsStore.getState().unreadCount).toBe(1));
    expect(notificationSpy).toHaveBeenCalledTimes(1);
    expect(soundSpy).toHaveBeenCalledTimes(1);
  });

  it("requests desktop permission and notifies after grant", async () => {
    const fakeSocket = new FakeWebSocket();
    const notificationSpy = vi.fn();
    const requestPermSpy = vi.fn().mockResolvedValue("granted");

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "default" },
    });

    render(
      <Probe
        webSocketFactory={() => fakeSocket}
        notificationFactory={notificationSpy}
        requestNotificationPermission={requestPermSpy}
      />,
    );

    act(() => {
      fakeSocket.onopen?.(new Event("open"));
      fakeSocket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "alert_triggered",
            alert_id: "a-3",
            symbol: "NSE:HDFCBANK",
            condition: "breakout",
            triggered_value: 1700,
            timestamp: "2026-03-05T00:00:00Z",
          }),
        }),
      );
    });

    await waitFor(() => expect(requestPermSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(notificationSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useAlertsStore.getState().unreadCount).toBe(1));
  });
});
