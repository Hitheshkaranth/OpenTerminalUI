import { useId, useMemo } from "react";

export type TerminalTabItem = {
  id: string;
  label: string;
  disabled?: boolean;
  badge?: string;
};

type Props = {
  items: TerminalTabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  size?: "sm" | "md";
};

export function TerminalTabs({ items, value, onChange, className = "", size = "md" }: Props) {
  const baseId = useId();
  const activeIndex = useMemo(() => Math.max(0, items.findIndex((item) => item.id === value)), [items, value]);

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={`inline-flex flex-wrap items-center gap-1 rounded-sm border border-terminal-border bg-terminal-panel p-1 ${className}`.trim()}
      onKeyDown={(event) => {
        if (!items.length) return;
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        let nextIndex = activeIndex;
        if (event.key === "ArrowRight") nextIndex = (activeIndex + 1) % items.length;
        if (event.key === "ArrowLeft") nextIndex = (activeIndex - 1 + items.length) % items.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = items.length - 1;
        const next = items[nextIndex];
        if (next && !next.disabled) onChange(next.id);
      }}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            id={`${baseId}-tab-${item.id}`}
            role="tab"
            aria-selected={active}
            aria-controls={`${baseId}-panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            className={[
              "inline-flex items-center gap-1 rounded-sm border px-2 outline-none transition-colors",
              "focus-visible:ring-1 focus-visible:ring-terminal-accent/40 disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "min-h-8" : "min-h-9",
              active
                ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                : "border-terminal-border text-terminal-muted hover:text-terminal-text",
            ]
              .join(" ")
              .trim()}
            onClick={() => onChange(item.id)}
          >
            <span className="ot-type-label">{item.label}</span>
            {item.badge ? <span className="ot-type-badge text-terminal-muted">{item.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
