import { useEffect, useRef, useState } from "react";

import { TerminalToast, TerminalToastViewport } from "../terminal/TerminalToast";

type AlertToastEventDetail = {
  title?: string;
  message: string;
  variant?: "info" | "success" | "warning" | "danger";
  ttlMs?: number;
};

type ToastItem = {
  id: string;
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "danger";
  ttlMs: number;
};

const CHIME_KEY = "ot:alerts:chime:v1";

function readChimeEnabled() {
  try {
    const raw = localStorage.getItem(CHIME_KEY);
    if (!raw) return true;
    return JSON.parse(raw) !== false;
  } catch {
    return true;
  }
}

function playChime() {
  try {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    window.setTimeout(() => {
      void ctx.close();
    }, 220);
  } catch {
    // ignore chime failures
  }
}

export function AlertToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const onToast = (event: Event) => {
      const customEvent = event as CustomEvent<AlertToastEventDetail>;
      const detail = customEvent.detail;
      if (!detail?.message) return;
      const next: ToastItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: detail.title || "Alert",
        message: detail.message,
        variant: detail.variant || "warning",
        ttlMs: Number.isFinite(Number(detail.ttlMs)) ? Math.max(1200, Number(detail.ttlMs)) : 4500,
      };
      setToasts((prev) => [next, ...prev].slice(0, 5));
      if (readChimeEnabled()) playChime();
    };
    window.addEventListener("ot:alert-toast", onToast as EventListener);
    return () => window.removeEventListener("ot:alert-toast", onToast as EventListener);
  }, []);

  useEffect(() => {
    for (const toast of toasts) {
      if (timersRef.current[toast.id]) continue;
      timersRef.current[toast.id] = window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== toast.id));
        delete timersRef.current[toast.id];
      }, toast.ttlMs);
    }
    return () => {
      for (const id of Object.keys(timersRef.current)) {
        if (toasts.some((item) => item.id === id)) continue;
        window.clearTimeout(timersRef.current[id]);
        delete timersRef.current[id];
      }
    };
  }, [toasts]);

  useEffect(
    () => () => {
      for (const id of Object.keys(timersRef.current)) {
        window.clearTimeout(timersRef.current[id]);
      }
      timersRef.current = {};
    },
    [],
  );

  if (!toasts.length) return null;

  return (
    <TerminalToastViewport className="top-auto bottom-8">
      {toasts.map((toast) => (
        <TerminalToast
          key={toast.id}
          title={toast.title}
          message={toast.message}
          variant={toast.variant}
          action={
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
              className="rounded-sm border border-terminal-border px-2 py-0.5 text-[11px] text-terminal-muted hover:text-terminal-text"
            >
              Dismiss
            </button>
          }
        />
      ))}
    </TerminalToastViewport>
  );
}
