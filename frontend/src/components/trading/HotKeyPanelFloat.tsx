import { useEffect, useRef, useState } from "react";
import { Minus, Move, X } from "lucide-react";

import { HotKeyPanel } from "./HotKeyPanel";

const VISIBILITY_KEY = "ot:hotkey-panel:visible:v1";
const POSITION_KEY = "ot:hotkey-panel:position:v1";
const MINIMIZED_KEY = "ot:hotkey-panel:minimized:v1";

function readBool(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) === true;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function HotKeyPanelFloat() {
  const [visible, setVisible] = useState<boolean>(() => readBool(VISIBILITY_KEY, false));
  const [minimized, setMinimized] = useState<boolean>(() => readBool(MINIMIZED_KEY, false));
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 24, y: 120 };
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (!raw) return { x: Math.max(16, window.innerWidth - 344), y: Math.max(72, window.innerHeight - 580) };
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      return {
        x: Number.isFinite(Number(parsed?.x)) ? Number(parsed.x) : Math.max(16, window.innerWidth - 344),
        y: Number.isFinite(Number(parsed?.y)) ? Number(parsed.y) : Math.max(72, window.innerHeight - 580),
      };
    } catch {
      return { x: Math.max(16, window.innerWidth - 344), y: Math.max(72, window.innerHeight - 580) };
    }
  });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => writeJson(VISIBILITY_KEY, visible), [visible]);
  useEffect(() => writeJson(MINIMIZED_KEY, minimized), [minimized]);
  useEffect(() => writeJson(POSITION_KEY, position), [position]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "t") return;
      event.preventDefault();
      setVisible((prev) => !prev);
      setMinimized(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: Math.max(8, dragRef.current.originX + (event.clientX - dragRef.current.startX)),
        y: Math.max(56, dragRef.current.originY + (event.clientY - dragRef.current.startY)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed z-[70] w-[320px] max-w-[calc(100vw-16px)]"
      style={{ left: position.x, top: position.y }}
      data-testid="hotkey-panel-float"
    >
      <div className="overflow-hidden rounded-sm border border-terminal-border bg-terminal-panel shadow-2xl">
        <div
          className="flex cursor-move items-center justify-between border-b border-terminal-border bg-terminal-bg px-2 py-1.5"
          onMouseDown={(event) => {
            dragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              originX: position.x,
              originY: position.y,
            };
          }}
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-terminal-accent">
            <Move className="h-3.5 w-3.5" />
            Hot Keys
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMinimized((prev) => !prev)}
              className="rounded-sm border border-terminal-border p-1 text-terminal-muted hover:text-terminal-text"
              aria-label={minimized ? "Expand hotkey panel" : "Minimize hotkey panel"}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="rounded-sm border border-terminal-border p-1 text-terminal-muted hover:text-terminal-text"
              aria-label="Close hotkey panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {!minimized ? <HotKeyPanel className="border-0 rounded-none" autoFocus /> : null}
      </div>
    </div>
  );
}
