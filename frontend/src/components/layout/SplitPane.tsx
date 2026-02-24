import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Orientation = "horizontal" | "vertical";

type Props = {
  orientation?: Orientation;
  initialRatio?: number;
  minPrimaryPct?: number;
  minSecondaryPct?: number;
  primary: ReactNode;
  secondary: ReactNode;
  className?: string;
  paneClassName?: string;
  handleClassName?: string;
  storageKey?: string;
};

function clampRatio(value: number, minPrimary: number, minSecondary: number) {
  const min = minPrimary;
  const max = 100 - minSecondary;
  return Math.min(max, Math.max(min, value));
}

export function SplitPane({
  orientation = "vertical",
  initialRatio = 50,
  minPrimaryPct = 20,
  minSecondaryPct = 20,
  primary,
  secondary,
  className = "",
  paneClassName = "",
  handleClassName = "",
  storageKey,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState<number>(() => {
    if (!storageKey) return initialRatio;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? parsed : initialRatio;
    } catch {
      return initialRatio;
    }
  });

  const safeRatio = useMemo(
    () => clampRatio(ratio, minPrimaryPct, minSecondaryPct),
    [ratio, minPrimaryPct, minSecondaryPct],
  );

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, String(safeRatio));
    } catch {
      // ignore storage failures
    }
  }, [safeRatio, storageKey]);

  const vertical = orientation === "vertical";

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const root = rootRef.current;
    if (!root) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const updateFromEvent = (clientX: number, clientY: number) => {
      const rect = root.getBoundingClientRect();
      const nextRatio = vertical
        ? ((clientX - rect.left) / rect.width) * 100
        : ((clientY - rect.top) / rect.height) * 100;
      if (!Number.isFinite(nextRatio)) return;
      setRatio(clampRatio(nextRatio, minPrimaryPct, minSecondaryPct));
    };

    updateFromEvent(event.clientX, event.clientY);

    const onMove = (moveEvent: PointerEvent) => updateFromEvent(moveEvent.clientX, moveEvent.clientY);
    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // ignore if capture already released
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={rootRef}
      className={[
        "min-h-0 min-w-0",
        vertical ? "grid grid-cols-[minmax(0,var(--split-a))_10px_minmax(0,var(--split-b))]" : "grid grid-rows-[minmax(0,var(--split-a))_10px_minmax(0,var(--split-b))]",
        className,
      ]
        .join(" ")
        .trim()}
      style={
        {
          ["--split-a" as string]: `${safeRatio}%`,
          ["--split-b" as string]: `${100 - safeRatio}%`,
        } as CSSProperties
      }
    >
      <div className={`min-h-0 min-w-0 overflow-hidden ${paneClassName}`.trim()}>{primary}</div>
      <button
        type="button"
        aria-label={`Resize ${vertical ? "columns" : "rows"}`}
        aria-valuemin={minPrimaryPct}
        aria-valuemax={100 - minSecondaryPct}
        aria-valuenow={Math.round(safeRatio)}
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 2;
          if ((vertical && event.key === "ArrowLeft") || (!vertical && event.key === "ArrowUp")) {
            event.preventDefault();
            setRatio((prev) => clampRatio(prev - step, minPrimaryPct, minSecondaryPct));
          } else if ((vertical && event.key === "ArrowRight") || (!vertical && event.key === "ArrowDown")) {
            event.preventDefault();
            setRatio((prev) => clampRatio(prev + step, minPrimaryPct, minSecondaryPct));
          } else if (event.key === "Home") {
            event.preventDefault();
            setRatio(minPrimaryPct);
          } else if (event.key === "End") {
            event.preventDefault();
            setRatio(100 - minSecondaryPct);
          }
        }}
        className={[
          "group relative m-0 rounded-sm border border-terminal-border bg-terminal-bg/60 p-0 outline-none",
          "focus-visible:ring-1 focus-visible:ring-terminal-accent/40",
          vertical ? "cursor-col-resize" : "cursor-row-resize",
          handleClassName,
        ]
          .join(" ")
          .trim()}
      >
        <span
          aria-hidden="true"
          className={[
            "absolute inset-0 m-auto rounded-sm bg-terminal-border transition-colors group-hover:bg-terminal-accent/70",
            vertical ? "h-8 w-[2px]" : "h-[2px] w-8",
          ]
            .join(" ")
            .trim()}
        />
      </button>
      <div className={`min-h-0 min-w-0 overflow-hidden ${paneClassName}`.trim()}>{secondary}</div>
    </div>
  );
}
