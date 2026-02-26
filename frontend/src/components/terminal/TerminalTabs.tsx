import { useId, useMemo, ReactNode } from "react";

export type TerminalTabItem = {
  id: string;
  label: string;
  disabled?: boolean;
  badge?: string;
  icon?: ReactNode;
};

type Props = {
  items?: TerminalTabItem[];
  tabs?: TerminalTabItem[];
  value?: string;
  activeTab?: string;
  onChange: (id: string) => void;
  className?: string;
  size?: "sm" | "md";
  variant?: "default" | "accent";
  fullWidth?: boolean;
};

function moveToEnabled(items: TerminalTabItem[], activeIndex: number, direction: 1 | -1) {
  if (!items.length) return -1;
  let nextIndex = activeIndex;
  for (let i = 0; i < items.length; i += 1) {
    nextIndex = (nextIndex + direction + items.length) % items.length;
    if (!items[nextIndex]?.disabled) return nextIndex;
  }
  return activeIndex;
}

export function TerminalTabs({
  items,
  tabs,
  value,
  activeTab,
  onChange,
  className = "",
  size = "md",
  variant = "default",
  fullWidth = false,
}: Props) {
  const baseId = useId();
  const actualItems = items || tabs || [];
  const actualValue = value || activeTab || "";
  const activeIndex = useMemo(() => Math.max(0, actualItems.findIndex((item) => item.id === actualValue)), [actualItems, actualValue]);

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={`inline-flex flex-wrap items-center gap-1 rounded-sm border border-terminal-border bg-terminal-panel p-1 ${fullWidth ? "w-full" : ""} ${className}`.trim()}
      onKeyDown={(event) => {
        if (!actualItems.length) return;
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        let nextIndex = activeIndex;
        if (event.key === "ArrowRight") nextIndex = moveToEnabled(actualItems, activeIndex, 1);
        if (event.key === "ArrowLeft") nextIndex = moveToEnabled(actualItems, activeIndex, -1);
        if (event.key === "Home") nextIndex = actualItems.findIndex((item) => !item.disabled);
        if (event.key === "End") {
          for (let i = actualItems.length - 1; i >= 0; i -= 1) {
            if (!actualItems[i]?.disabled) {
              nextIndex = i;
              break;
            }
          }
        }
        const next = actualItems[nextIndex];
        if (next && !next.disabled) onChange(next.id);
      }}
    >
      {actualItems.map((item) => {
        const active = item.id === actualValue;
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
              "inline-flex items-center gap-1.5 rounded-sm border px-2 outline-none transition-colors",
              fullWidth ? "flex-1 justify-center" : "",
              "focus-visible:ring-1 focus-visible:ring-terminal-accent/40 disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "min-h-8" : "min-h-9",
              active
                ? variant === "accent"
                  ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent"
                  : "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                : "border-terminal-border text-terminal-muted hover:text-terminal-text",
            ]
              .join(" ")
              .trim()}
            onClick={() => {
              if (!item.disabled) onChange(item.id);
            }}
          >
            {item.icon && <span className="flex-shrink-0 opacity-70">{item.icon}</span>}
            <span className="ot-type-label">{item.label}</span>
            {item.badge ? <span className="ot-type-badge text-terminal-muted">{item.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
