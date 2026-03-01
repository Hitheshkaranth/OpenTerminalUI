import { useEffect, useMemo, useRef, useState } from "react";

type DropdownItem = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  badge?: string;
};

type Props = {
  label: string;
  items: DropdownItem[];
  onSelect: (id: string) => void;
  className?: string;
  align?: "left" | "right";
  size?: "sm" | "md" | "lg";
  variant?: "default" | "accent" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  "aria-label"?: string;
};

const triggerSizeClass = {
  sm: "min-h-8 px-2 py-1 text-[10px]",
  md: "min-h-9 px-2.5 py-1 text-[11px]",
  lg: "min-h-10 px-3 py-1.5 text-xs",
} as const;

const triggerVariantClass = {
  default: "border-terminal-border text-terminal-muted hover:text-terminal-text",
  accent: "border-terminal-accent bg-terminal-accent/10 text-terminal-accent hover:bg-terminal-accent/20",
  ghost: "border-transparent text-terminal-muted hover:border-terminal-border hover:bg-terminal-bg hover:text-terminal-text",
} as const;

function findNextEnabledIndex(items: DropdownItem[], start: number, direction: 1 | -1) {
  if (!items.length) return -1;
  let idx = start;
  for (let i = 0; i < items.length; i += 1) {
    idx = (idx + direction + items.length) % items.length;
    if (!items[idx]?.disabled) return idx;
  }
  return -1;
}

export function TerminalDropdown({
  label,
  items,
  onSelect,
  className = "",
  align = "left",
  size = "md",
  variant = "default",
  disabled = false,
  loading = false,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useMemo(() => `terminal-dd-${Math.random().toString(36).slice(2, 8)}`, []);

  useEffect(() => {
    if (!open) return;
    const firstEnabled = items.findIndex((item) => !item.disabled);
    setActiveIndex(firstEnabled);
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const selectItem = (item: DropdownItem) => {
    if (item.disabled) return;
    setOpen(false);
    onSelect(item.id);
  };

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`.trim()}>
      <button
        type="button"
        className={[
          "inline-flex items-center gap-1 rounded-sm border ot-type-label outline-none transition-colors",
          "focus-visible:ring-1 focus-visible:ring-terminal-accent/40 disabled:cursor-not-allowed disabled:opacity-60",
          triggerSizeClass[size],
          triggerVariantClass[variant],
        ].join(" ")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (disabled || loading) return;
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {loading ? <span className="inline-block h-2 w-2 animate-pulse rounded-sm bg-current opacity-80" aria-hidden="true" /> : null}
        {label}
        <span aria-hidden="true" className="text-[9px] opacity-70">v</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className={`absolute top-[calc(100%+4px)] z-30 min-w-44 rounded-sm border border-terminal-border bg-terminal-panel p-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
          onKeyDown={(event) => {
            if (!items.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((idx) => findNextEnabledIndex(items, idx < 0 ? -1 : idx, 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((idx) => findNextEnabledIndex(items, idx < 0 ? 0 : idx, -1));
              return;
            }
            if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(items.findIndex((item) => !item.disabled));
              return;
            }
            if (event.key === "End") {
              event.preventDefault();
              for (let i = items.length - 1; i >= 0; i -= 1) {
                if (!items[i]?.disabled) {
                  setActiveIndex(i);
                  break;
                }
              }
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              const item = activeIndex >= 0 ? items[activeIndex] : undefined;
              if (item) selectItem(item);
            }
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left ${
                item.danger ? "text-terminal-neg" : "text-terminal-text"
              } ot-type-ui text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                activeIndex === index ? "bg-terminal-bg" : "hover:bg-terminal-bg"
              }`}
              onMouseEnter={() => {
                if (!item.disabled) setActiveIndex(index);
              }}
              onClick={() => selectItem(item)}
            >
              <span>{item.label}</span>
              {item.badge ? <span className="ot-type-badge text-terminal-muted">{item.badge}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
